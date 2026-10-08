import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import {
  createSchedulingFixture,
  responseCookies,
  mutation,
} from '../support/scheduling-fixture.js';
import type { PrivateStorage } from '../../src/domains/imaging/storage.js';
import type { InferenceClient } from '../../src/domains/imaging/inference.js';
import { checksum } from '../../src/domains/imaging/image-validation.js';
import { ImagingRepository } from '../../src/domains/imaging/imaging.repository.js';
import { AuthIdentitySchema } from '@dentalai/contracts';

const objects = new Map<string, Buffer>();
let storageFailure = false;
let inferenceFailure = false;
const storage: PrivateStorage = {
  bucket: 'fictional-private',
  async put(key, data) {
    if (storageFailure) throw new Error('private failure');
    objects.set(key, data);
  },
  async get(key) {
    const data = objects.get(key);
    if (!data) throw new Error('not found');
    return data;
  },
};
// Injection-only contract fixture, NOT production inference or a medical performance assertion.
const inference: InferenceClient = {
  async infer(data) {
    if (inferenceFailure) throw new Error('secret path');
    return {
      modelName: 'contract-fixture',
      modelVersion: 'test-only',
      artifactSha256: 'a'.repeat(64),
      imageSha256: checksum(data),
      classMap: ['fixture'],
      confidenceThreshold: 0.5,
      iouThreshold: 0.5,
      latencyMs: 1,
      postprocessingVersion: 'yolov8-onnx-v1',
      rawDetections: [],
      rawPredictions: [],
      detections: [],
    };
  },
};
let fixture: Awaited<ReturnType<typeof createSchedulingFixture>>;
let png: Buffer;
beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('Disposable DATABASE_URL required');
  fixture = await createSchedulingFixture(url, 'https://imaging.example.test', undefined, {
    storage,
    inference,
  });
  png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
});
afterAll(async () => fixture?.dispose());
async function upload(role = 'dentist', patient = fixture.patientId, data = png, studyId?: string) {
  const csrf = await request(fixture.app).get('/api/v1/access/csrf').expect(200);
  return request(fixture.app)
    .post(`/api/v1/imaging/patients/${patient}/images${studyId ? `?studyId=${studyId}` : ''}`)
    .set('origin', fixture.origin)
    .set('cookie', [fixture.members[role]?.cookie, ...responseCookies(csrf)].join('; '))
    .set('x-csrf-token', String(csrf.body.token))
    .set('content-type', 'image/png')
    .set('x-imaging-reason', 'Fictional technical test')
    .send(data);
}
describe('private imaging authorization and history', () => {
  it('blocks anonymous, all non-dentist roles and cross-clinic upload', async () => {
    await request(fixture.app).get(`/api/v1/imaging/patients/${fixture.patientId}`).expect(401);
    for (const role of ['patient', 'receptionist', 'clinic_admin', 'clinic_owner', 'foreign'])
      expect((await upload(role)).status).toBe(403);
    expect((await upload('dentist', fixture.foreignPatientId)).status).toBe(404);
    expect(objects.size).toBe(0);
  });
  it('rejects malicious, forged, malformed and oversized uploads', async () => {
    expect((await upload('dentist', fixture.patientId, Buffer.from('<svg/>'))).status).toBe(422);
    expect(
      (await upload('dentist', fixture.patientId, Buffer.alloc(10 * 1024 * 1024 + 1))).status,
    ).toBe(413);
    const result = await mutation(
      fixture.app,
      fixture.origin,
      `/api/v1/imaging/images/not-uuid/analyses`,
      { reason: 'test' },
      fixture.members['dentist']!.cookie,
    );
    expect(result.status).toBe(422);
    expect(objects.size).toBe(0);
  });
  it('preserves versions, private streams, analyses and terminal review history', async () => {
    const first = await upload();
    expect(first.status).toBe(201);
    const second = await upload('dentist', fixture.patientId, png, String(first.body.studyId));
    expect(second.status).toBe(201);
    expect(second.body.version).toBe(2);
    await request(fixture.app)
      .get(`/api/v1/imaging/images/${first.body.id}/content`)
      .set('cookie', fixture.members['dentist']!.cookie)
      .expect(200)
      .expect('cache-control', 'private, no-store');
    for (const role of ['patient', 'receptionist', 'clinic_admin', 'clinic_owner', 'foreign'])
      await request(fixture.app)
        .get(`/api/v1/imaging/images/${first.body.id}/content`)
        .set('cookie', fixture.members[role]!.cookie)
        .expect(403);
    const analyze = await mutation(
      fixture.app,
      fixture.origin,
      `/api/v1/imaging/images/${first.body.id}/analyses`,
      { reason: 'Fictional technical analysis' },
      fixture.members['dentist']!.cookie,
    );
    expect(analyze.status).toBe(201);
    expect(analyze.body.reviewState).toBe('draft');
    for (const role of ['patient', 'receptionist', 'clinic_admin', 'clinic_owner', 'foreign']) {
      const denied = await mutation(
        fixture.app,
        fixture.origin,
        `/api/v1/imaging/analyses/${analyze.body.id}/review`,
        { decision: 'confirmed', reason: 'Fictional review' },
        fixture.members[role]!.cookie,
      );
      expect(denied.status).toBe(403);
    }
    const review = () =>
      mutation(
        fixture.app,
        fixture.origin,
        `/api/v1/imaging/analyses/${analyze.body.id}/review`,
        { decision: 'confirmed', reason: 'Fictional review' },
        fixture.members['dentist']!.cookie,
      );
    const concurrent = await Promise.all([review(), review()]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
    const history = await request(fixture.app)
      .get(`/api/v1/imaging/patients/${fixture.patientId}`)
      .set('cookie', fixture.members['dentist']!.cookie)
      .expect(200);
    expect(history.body.images).toHaveLength(2);
    expect(history.body.analyses[0].reviewState).toBe('confirmed');
    const file = await fixture.database.pool.query(
      'SELECT file_id FROM clinical_image_versions WHERE id=$1',
      [first.body.id],
    );
    await expect(
      fixture.database.pool.query('DELETE FROM files WHERE id=$1', [file.rows[0].file_id]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      fixture.database.pool.query('DELETE FROM image_inference_runs WHERE id=$1', [
        analyze.body.id,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      fixture.database.pool.query('UPDATE clinical_image_versions SET clinic_id=$1 WHERE id=$2', [
        fixture.otherClinicId,
        first.body.id,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
  });
  it('records inference errors without results, and retains managed pending uploads on storage failure', async () => {
    const image = await upload();
    expect(image.status).toBe(201);
    inferenceFailure = true;
    const result = await mutation(
      fixture.app,
      fixture.origin,
      `/api/v1/imaging/images/${image.body.id}/analyses`,
      { reason: 'Fictional unavailable test' },
      fixture.members['dentist']!.cookie,
    );
    inferenceFailure = false;
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toContain('secret');
    const failed = await fixture.database.pool.query(
      "SELECT result,error_code FROM image_inference_runs WHERE image_id=$1 AND status='failed'",
      [image.body.id],
    );
    expect(failed.rows[0]).toEqual({ result: null, error_code: 'INFERENCE_UNAVAILABLE' });
    storageFailure = true;
    expect((await upload()).status).toBe(503);
    storageFailure = false;
    const pending = await fixture.database.pool.query(
      "SELECT count(*)::integer AS n FROM files WHERE status='pending'",
    );
    expect(pending.rows[0].n).toBe(1);
  });
  it('database prevents cross-tenant references', async () => {
    await expect(
      fixture.database.pool.query(
        'INSERT INTO image_inference_runs(id,clinic_id,image_id,requested_by_membership_id,reason) VALUES($1,$2,$3,$4,$5)',
        [
          randomUUID(),
          fixture.otherClinicId,
          randomUUID(),
          fixture.members['dentist']!.membershipId,
          'Fictional test',
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('missing inference configuration fails closed and records no result', async () => {
    const image = await upload();
    expect(image.status).toBe(201);
    const me = await request(fixture.app)
      .get('/api/v1/access/me')
      .set('cookie', fixture.members['dentist']!.cookie)
      .expect(200);
    const identity = AuthIdentitySchema.parse(me.body);
    const session = await fixture.database.pool.query<{ id: string }>(
      'SELECT id FROM auth_sessions WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC LIMIT 1',
      [identity.user.id],
    );
    const repository = new ImagingRepository(fixture.database.pool, storage);
    const context = {
      userId: identity.user.id,
      sessionId: session.rows[0]!.id,
      membership: identity.activeMembership,
      requestId: randomUUID(),
    };
    expect(await repository.capabilities(context)).toEqual({
      storageConfigured: true,
      inferenceConfigured: false,
      clinicallyValidated: false,
    });
    await expect(
      repository.analyze(context, String(image.body.id), 'Fictional missing model'),
    ).rejects.toMatchObject({ code: 'INFERENCE_UNAVAILABLE' });
    const history = await repository.history(context, fixture.patientId);
    expect(history.analyses.find((r) => r.imageId === image.body.id)).toMatchObject({
      status: 'failed',
      result: null,
      reviewState: 'draft',
    });
  });
  it('a dentist in another clinic cannot read, analyze, version or review this clinic resources', async () => {
    const staffId = randomUUID();
    await fixture.database.pool.query(
      "INSERT INTO staff(id,clinic_id,membership_id,kind) VALUES($1,$2,$3,'provider')",
      [staffId, fixture.otherClinicId, fixture.members['foreign']!.membershipId],
    );
    await fixture.database.pool.query(
      "INSERT INTO providers(clinic_id,staff_id,provider_type) VALUES($1,$2,'dentist')",
      [fixture.otherClinicId, staffId],
    );
    await fixture.database.pool.query(
      'INSERT INTO membership_roles(clinic_id,membership_id,role_id) SELECT $1,$2,id FROM roles WHERE clinic_id=$1 AND key=$3',
      [fixture.otherClinicId, fixture.members['foreign']!.membershipId, 'dentist'],
    );
    const image = await fixture.database.pool.query(
      'SELECT id,study_id FROM clinical_image_versions WHERE clinic_id=$1 LIMIT 1',
      [fixture.clinicId],
    );
    const run = await fixture.database.pool.query(
      "SELECT id FROM image_inference_runs WHERE clinic_id=$1 AND status='succeeded' LIMIT 1",
      [fixture.clinicId],
    );
    const cookie = fixture.members['foreign']!.cookie;
    await request(fixture.app)
      .get(`/api/v1/imaging/patients/${fixture.patientId}`)
      .set('cookie', cookie)
      .expect(404);
    await request(fixture.app)
      .get(`/api/v1/imaging/images/${image.rows[0].id}/content`)
      .set('cookie', cookie)
      .expect(404);
    expect(
      (
        await mutation(
          fixture.app,
          fixture.origin,
          `/api/v1/imaging/images/${image.rows[0].id}/analyses`,
          { reason: 'Fictional forbidden cross-clinic' },
          cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mutation(
          fixture.app,
          fixture.origin,
          `/api/v1/imaging/analyses/${run.rows[0].id}/review`,
          { reason: 'Fictional forbidden cross-clinic', decision: 'rejected' },
          cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (await upload('foreign', fixture.foreignPatientId, png, String(image.rows[0].study_id)))
        .status,
    ).toBe(404);
  });
  it('inactive providers cannot read or mutate imaging, including a database-level review', async () => {
    const image = await upload();
    expect(image.status).toBe(201);
    const run = await mutation(
      fixture.app,
      fixture.origin,
      `/api/v1/imaging/images/${image.body.id}/analyses`,
      { reason: 'Fictional provider test' },
      fixture.members['dentist']!.cookie,
    );
    expect(run.status).toBe(201);
    await fixture.database.pool.query('UPDATE providers SET active=false WHERE id=$1', [
      fixture.providerId,
    ]);
    try {
      await request(fixture.app)
        .get(`/api/v1/imaging/patients/${fixture.patientId}`)
        .set('cookie', fixture.members['dentist']!.cookie)
        .expect(403);
      await request(fixture.app)
        .get(`/api/v1/imaging/images/${image.body.id}/content`)
        .set('cookie', fixture.members['dentist']!.cookie)
        .expect(403);
      expect((await upload()).status).toBe(403);
      expect(
        (
          await mutation(
            fixture.app,
            fixture.origin,
            `/api/v1/imaging/images/${image.body.id}/analyses`,
            { reason: 'Fictional revoked provider' },
            fixture.members['dentist']!.cookie,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await mutation(
            fixture.app,
            fixture.origin,
            `/api/v1/imaging/analyses/${run.body.id}/review`,
            { reason: 'Fictional revoked provider', decision: 'confirmed' },
            fixture.members['dentist']!.cookie,
          )
        ).status,
      ).toBe(403);
      await expect(
        fixture.database.pool.query(
          'INSERT INTO image_clinician_reviews(clinic_id,run_id,decision,author_membership_id,reason) VALUES($1,$2,$3,$4,$5)',
          [
            fixture.clinicId,
            run.body.id,
            'confirmed',
            fixture.members['dentist']!.membershipId,
            'Fictional revoked provider',
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await fixture.database.pool.query('UPDATE providers SET active=true WHERE id=$1', [
        fixture.providerId,
      ]);
    }
  });
});
