import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createSchedulingFixture, mutation } from '../support/scheduling-fixture.js';

let fixture: Awaited<ReturnType<typeof createSchedulingFixture>>;
const body = () => ({
  input: {
    age: null,
    weight: null,
    solution: null,
    bloodPressure: null,
    allergies: { reviewed: false, items: [] },
    medications: { reviewed: false, items: [] },
    pregnancy: 'unknown',
    smoking: 'unknown',
    hepaticConditions: { reviewed: false, items: [] },
    renalConditions: { reviewed: false, items: [] },
    cardiovascularConditions: { reviewed: false, items: [] },
    otherContraindications: { reviewed: false, items: [] },
    exposure: { reviewed: false, doses: [] },
  },
  reason: 'Fictional software safety test',
  source: 'clinician_interview',
  observedAt: '2026-10-09T00:00:00Z',
});
beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('Disposable DATABASE_URL required');
  fixture = await createSchedulingFixture(url, 'https://anesthesia.example.test');
});
afterAll(async () => fixture?.dispose());
const create = (role = 'dentist', patient = fixture.patientId, data: object = body()) =>
  mutation(
    fixture.app,
    fixture.origin,
    `/api/v1/anesthesia/patients/${patient}/assessments`,
    data,
    fixture.members[role]!.cookie,
  );
const history = (role = 'dentist', patient = fixture.patientId) =>
  request(fixture.app)
    .get(`/api/v1/anesthesia/patients/${patient}`)
    .set('cookie', fixture.members[role]!.cookie);
describe('anesthesia safety, persistence and live authorization', () => {
  it('denies anonymous and every non-clinician role; derives clinic from session', async () => {
    await request(fixture.app).get(`/api/v1/anesthesia/patients/${fixture.patientId}`).expect(401);
    for (const role of ['patient', 'receptionist', 'clinic_admin', 'clinic_owner', 'foreign']) {
      expect((await create(role)).status).toBe(403);
      expect((await history(role)).status).toBe(403);
    }
    expect((await create('dentist', fixture.foreignPatientId)).status).toBe(404);
    expect((await history('dentist', fixture.foreignPatientId)).status).toBe(404);
  });
  it('rejects malformed input and browser-owned provenance without persisting', async () => {
    for (const data of [
      { ...body(), clinicId: fixture.otherClinicId },
      { ...body(), authorUserId: randomUUID() },
      { ...body(), input: { ...body().input, weight: { value: -1, unit: 'kg' } } },
      { ...body(), input: { ...body().input, bloodPressure: 120 } },
      {
        ...body(),
        input: {
          ...body().input,
          exposure: {
            reviewed: true,
            doses: [{ drug: 'fixture', amount: -1, unit: 'mg', administeredAt: body().observedAt }],
          },
        },
      },
    ])
      expect((await create('dentist', fixture.patientId, data)).status).toBe(422);
    expect((await history()).body).toEqual([]);
  });
  it('stores the exact engine outcome, trusted provenance, history and transactional audit', async () => {
    const first = await create();
    expect(first.status).toBe(201);
    const second = await create();
    expect(second.status).toBe(201);
    expect(second.body.version).toBe(2);
    expect(first.body.output.outcome).toBe('insufficient_data');
    expect(first.body.output.proposedMg).toBeNull();
    expect(first.body.approvalState).toBe('draft');
    expect(first.body.provenance.authorUserId).toBe(fixture.members['dentist']!.userId);
    expect(first.body.provenance.providerId).toBe(fixture.providerId);
    const records = await history();
    expect(records.status).toBe(200);
    expect(records.body).toHaveLength(2);
    expect(records.body[0]).toEqual(first.body);
    const audit = await fixture.database.pool.query(
      "SELECT data FROM audit_events WHERE action='anesthesia.assessed' AND entity_id=$1",
      [first.body.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].data.after.output).toEqual(first.body.output);
    await expect(
      fixture.database.pool.query('DELETE FROM anesthesia_assessments WHERE id=$1', [
        first.body.id,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      fixture.database.pool.query('UPDATE anesthesia_assessments SET inputs=$2 WHERE id=$1', [
        first.body.id,
        {},
      ]),
    ).rejects.toMatchObject({ code: '55000' });
    const confirm = `/api/v1/anesthesia/assessments/${first.body.id}/confirm`;
    expect(
      (
        await mutation(
          fixture.app,
          fixture.origin,
          confirm,
          { reason: 'Fictional clinician review' },
          fixture.members['dentist']!.cookie,
        )
      ).status,
    ).toBe(409);
    for (const role of ['patient', 'clinic_admin', 'clinic_owner', 'receptionist'])
      expect(
        (
          await mutation(
            fixture.app,
            fixture.origin,
            confirm,
            { reason: 'Fictional forbidden review' },
            fixture.members[role]!.cookie,
          )
        ).status,
      ).toBe(403);
    expect((await history()).body[0].approvalState).toBe('draft');
  });
  it('serializes concurrent new versions without losing historical assessments', async () => {
    const results = await Promise.all([create(), create()]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results.map((r) => r.body.version).sort()).toEqual([3, 4]);
    expect((await history()).body).toHaveLength(4);
  });
  it('rolls back assessment if audit insertion fails', async () => {
    await fixture.database.pool
      .query(`CREATE FUNCTION fail_anesthesia_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='anesthesia.assessed' THEN RAISE EXCEPTION 'private database test failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_anesthesia_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_anesthesia_audit();`);
    try {
      const result = await create();
      expect(result.status).toBe(500);
      expect(JSON.stringify(result.body)).not.toContain('private database test failure');
      expect((await history()).body).toHaveLength(4);
    } finally {
      await fixture.database.pool.query(
        'DROP TRIGGER fail_anesthesia_audit ON audit_events; DROP FUNCTION fail_anesthesia_audit()',
      );
    }
  });
  it('cross-clinic dentists cannot read, create or confirm assessments from another clinic', async () => {
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
    expect((await history('foreign')).status).toBe(404);
    expect((await create('foreign')).status).toBe(404);
    const record = await history();
    expect(
      (
        await mutation(
          fixture.app,
          fixture.origin,
          `/api/v1/anesthesia/assessments/${record.body[0].id}/confirm`,
          { reason: 'Fictional forbidden cross-clinic' },
          fixture.members['foreign']!.cookie,
        )
      ).status,
    ).toBe(404);
    const own = await create('foreign', fixture.foreignPatientId);
    expect(own.status).toBe(201);
    expect(
      (
        await mutation(
          fixture.app,
          fixture.origin,
          `/api/v1/anesthesia/assessments/${own.body.id}/confirm`,
          { reason: 'Fictional forbidden cross-clinic' },
          fixture.members['dentist']!.cookie,
        )
      ).status,
    ).toBe(404);
  });
  it('database rejects numeric output and approval with unapproved rules', async () => {
    const record = (await history()).body[0];
    const sql = `INSERT INTO anesthesia_assessments(clinic_id,patient_id,provider_id,rule_set_version,inputs,modeled_output)
      VALUES($1,$2,$3,'anesthesia-structure-v1',$4,$5)`;
    for (const output of [
      { ...record.output, maximumMg: 1 },
      { ...record.output, proposedMg: 1 },
      { ...record.output, recommendationEnabled: true },
      { ...record.output, approvalState: 'approved' },
    ])
      await expect(
        fixture.database.pool.query(sql, [
          fixture.clinicId,
          fixture.patientId,
          fixture.providerId,
          JSON.stringify({ input: record.input, provenance: record.provenance }),
          JSON.stringify(output),
        ]),
      ).rejects.toMatchObject({ code: '23514' });
  });
  it('rechecks active provider and revoked sessions', async () => {
    await fixture.database.pool.query('UPDATE providers SET active=false WHERE id=$1', [
      fixture.providerId,
    ]);
    try {
      expect((await create()).status).toBe(403);
      expect((await history()).status).toBe(403);
    } finally {
      await fixture.database.pool.query('UPDATE providers SET active=true WHERE id=$1', [
        fixture.providerId,
      ]);
    }
    await fixture.database.pool.query('DELETE FROM auth_sessions WHERE user_id=$1', [
      fixture.members['dentist']!.userId,
    ]);
    expect((await history()).status).toBe(401);
    expect((await create()).status).toBe(401);
  });
});
