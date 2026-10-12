import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createSchedulingFixture,
  mutation,
  responseCookies,
} from '../support/scheduling-fixture.js';
import { FilesystemPrivateStorage } from '../../src/domains/imaging/filesystem-storage.js';
import { AdministrationRepository } from '../../src/domains/administration/administration.repository.js';
import { OutboxWorker } from '../../src/workers/outbox.worker.js';
import {
  notificationHandlers,
  enqueueNotification,
} from '../../src/domains/notifications/notification.service.js';
import type { AuthMail } from '../../src/domains/auth/mail.js';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('Disposable PostgreSQL is required.');
let f: Awaited<ReturnType<typeof createSchedulingFixture>>;
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'dentalai-phase13-storage-'));
  f = await createSchedulingFixture(url, undefined, undefined, {
    storage: new FilesystemPrivateStorage(directory),
  });
  await f.database.pool.query(
    'INSERT INTO clinic_settings(clinic_id,appointment_horizon_days) VALUES($1,3650)',
    [f.clinicId],
  );
});
afterAll(async () => {
  if (f) await f.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  await f.database.pool.query('DELETE FROM auth_rate_limits');
  await f.database.pool.query(
    "UPDATE clinic_subscriptions SET plan_code='legacy',state='active',period_end=NULL,grace_end=NULL,cancel_at_period_end=false WHERE clinic_id=$1",
    [f.clinicId],
  );
});
const user = (role: string) => f.members[role]!;
const get = (path: string, role = 'clinic_owner') =>
  request(f.app).get(`/api/v1/admin/${path}`).set('cookie', user(role).cookie);
const write = (
  path: string,
  body: object,
  role = 'clinic_owner',
  method: 'post' | 'put' = 'post',
) => mutation(f.app, f.origin, `/api/v1/admin/${path}`, body, user(role).cookie, method);
const location = (name: string) => ({
  name,
  timezone: 'Asia/Baghdad',
  address: 'Fictional address',
  phone: null,
  active: true,
  reason: 'Fictional test',
});

describe('real administration API and PostgreSQL gates', () => {
  it('rejects anonymous, unverified and stale membership access', async () => {
    await request(f.app).get('/api/v1/admin/overview').expect(401);
    await f.database.pool.query('UPDATE users SET email_verified=false WHERE id=$1', [
      user('patient').userId,
    ]);
    try {
      expect(
        (
          await write(
            'onboarding',
            {
              legalName: 'Unverified',
              displayName: 'Unverified',
              slug: 'unverified',
              timezone: 'Asia/Baghdad',
              currency: 'SYP',
              locale: 'en',
              contactEmail: null,
              contactPhone: null,
              brandColor: '#4f46e5',
              brandMark: 'UV',
              locationName: 'Office',
              authorityConfirmed: true,
            },
            'patient',
          )
        ).status,
      ).toBe(403);
    } finally {
      await f.database.pool.query('UPDATE users SET email_verified=true WHERE id=$1', [
        user('patient').userId,
      ]);
    }
    const session = (
      await request(f.app)
        .get('/api/v1/access/sessions')
        .set('cookie', user('patient').cookie)
        .expect(200)
    ).body.find((s: { current: boolean }) => s.current);
    const identity = (
      await request(f.app)
        .get('/api/v1/access/me')
        .set('cookie', user('patient').cookie)
        .expect(200)
    ).body;
    const context = {
      userId: user('patient').userId,
      sessionId: session.id,
      requestId: randomUUID(),
      membership: identity.activeMembership,
    };
    await f.database.pool.query("UPDATE memberships SET status='suspended' WHERE id=$1", [
      user('patient').membershipId,
    ]);
    try {
      await expect(
        new AdministrationRepository(f.database.pool, f.authOptions).preferences(context, false),
      ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    } finally {
      await f.database.pool.query("UPDATE memberships SET status='active' WHERE id=$1", [
        user('patient').membershipId,
      ]);
    }
  });
  it('serializes concurrent bookings at the plan limit and rolls back the losing transaction', async () => {
    await f.database.pool.query(
      "UPDATE clinic_subscriptions SET plan_code='starter' WHERE clinic_id=$1",
      [f.clinicId],
    );
    await f.database.pool.query(
      "UPDATE saas_plans SET appointments_per_month=1 WHERE code='starter'",
    );
    try {
      const slots = (
        await request(f.app)
          .get(
            `/api/v1/scheduling/availability?locationId=${f.locationId}&appointmentTypeId=${f.typeId}&date=2030-01-07`,
          )
          .set('cookie', user('patient').cookie)
          .expect(200)
      ).body.slots;
      const responses = await Promise.all([
        mutation(
          f.app,
          f.origin,
          '/api/v1/appointments',
          { slotToken: slots[0].token },
          user('patient').cookie,
        ),
        mutation(
          f.app,
          f.origin,
          '/api/v1/appointments',
          { slotToken: slots[2].token },
          user('patient').cookie,
        ),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(responses.find((r) => r.status === 409)!.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
      expect(
        (
          await f.database.pool.query('SELECT count(*) FROM appointments WHERE clinic_id=$1', [
            f.clinicId,
          ])
        ).rows[0].count,
      ).toBe('1');
      const winner = responses.find((r) => r.status === 200)!.body;
      expect(
        (
          await mutation(
            f.app,
            f.origin,
            `/api/v1/appointments/${winner.id}/actions`,
            { action: 'cancel', revision: 0, reason: 'Fictional cancellation' },
            user('patient').cookie,
          )
        ).status,
      ).toBe(200);
      expect(
        (await f.database.pool.query("SELECT saas_usage($1,'appointments') AS usage", [f.clinicId]))
          .rows[0].usage,
      ).toBe('1');
    } finally {
      await f.database.pool.query(
        "UPDATE saas_plans SET appointments_per_month=100 WHERE code='starter'",
      );
    }
  });
  it('rejects exhausted private storage before saving bytes, then exports authorized real private files only', async () => {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } })
      .png()
      .toBuffer();
    const upload = async () => {
      const csrf = await request(f.app).get('/api/v1/access/csrf').expect(200);
      return request(f.app)
        .post(`/api/v1/imaging/patients/${f.patientId}/images`)
        .set('origin', f.origin)
        .set('cookie', [user('dentist').cookie, ...responseCookies(csrf)].join('; '))
        .set('x-csrf-token', String(csrf.body.token))
        .set('content-type', 'image/png')
        .set('x-imaging-reason', 'Synthetic quota test')
        .send(png);
    };
    await f.database.pool.query(
      "UPDATE clinic_subscriptions SET plan_code='starter' WHERE clinic_id=$1",
      [f.clinicId],
    );
    await f.database.pool.query("UPDATE saas_plans SET storage_bytes=1 WHERE code='starter'");
    try {
      const denied = await upload();
      expect(denied.status, JSON.stringify(denied.body)).toBe(409);
      expect(denied.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
      expect(
        (await f.database.pool.query('SELECT count(*) FROM files WHERE clinic_id=$1', [f.clinicId]))
          .rows[0].count,
      ).toBe('0');
    } finally {
      await f.database.pool.query(
        "UPDATE saas_plans SET storage_bytes=52428800 WHERE code='starter'",
      );
    }
    const uploaded = await upload();
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const file = (
      await f.database.pool.query('SELECT id FROM files WHERE clinic_id=$1', [f.clinicId])
    ).rows[0];
    await get(`export-files/${file.id}`, 'clinic_admin').expect(403);
    await get(`export-files/${file.id}`, 'foreign').expect(404);
    const stream = await get(`export-files/${file.id}`)
      .expect(200)
      .expect('content-type', 'image/png')
      .expect('cache-control', 'private, no-store');
    expect(Buffer.isBuffer(stream.body)).toBe(true);
    const stored = (await f.database.pool.query('SELECT sha256 FROM files WHERE id=$1', [file.id]))
      .rows[0];
    expect(createHash('sha256').update(stream.body).digest('hex')).toBe(stored.sha256);
  });
  it('limits pending invitation seats under concurrency at the database boundary', async () => {
    const usage = Number(
      (await f.database.pool.query("SELECT saas_usage($1,'seats') AS n", [f.clinicId])).rows[0].n,
    );
    await f.database.pool.query("UPDATE saas_plans SET seats=$1 WHERE code='starter'", [usage + 1]);
    await f.database.pool.query(
      "UPDATE clinic_subscriptions SET plan_code='starter' WHERE clinic_id=$1",
      [f.clinicId],
    );
    try {
      const responses = await Promise.all(
        ['seat-a@example.test', 'seat-b@example.test'].map((email) =>
          mutation(
            f.app,
            f.origin,
            '/api/v1/access/invitations',
            { email, role: 'dentist' },
            user('clinic_owner').cookie,
          ),
        ),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        Number(
          (await f.database.pool.query("SELECT saas_usage($1,'seats') AS n", [f.clinicId])).rows[0]
            .n,
        ),
      ).toBe(usage + 1);
      // Later delivery tests should not be confused by these deliberately unprocessed offers.
      await f.database.pool.query(
        "UPDATE invitations SET status='revoked' WHERE email IN ('seat-a@example.test','seat-b@example.test')",
      );
    } finally {
      await f.database.pool.query("UPDATE saas_plans SET seats=25 WHERE code='starter'");
    }
  });
  it('onboards a verified user into an isolated clinic without changing existing membership or trusting IDs/roles', async () => {
    const body = {
      legalName: 'Fictional isolated clinic',
      displayName: 'Isolated clinic',
      slug: 'isolated-clinic',
      timezone: 'Asia/Baghdad',
      currency: 'SYP',
      locale: 'ar',
      contactEmail: null,
      contactPhone: null,
      brandColor: '#4f46e5',
      brandMark: 'IC',
      locationName: 'Fictional office',
      authorityConfirmed: true,
    };
    expect((await write('onboarding', { ...body, clinicId: f.clinicId }, 'patient2')).status).toBe(
      400,
    );
    const response = await write('onboarding', body, 'patient2');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.clinicId).not.toBe(f.clinicId);
    expect(response.body.roles).toEqual(['clinic_owner']);
    const view = await get('overview', 'patient2').expect(200);
    expect(view.body.configuration.currency).toBe('SYP');
    expect(view.body.configuration.locale).toBe('ar');
    expect(view.body.members).toHaveLength(1);
    expect(view.body.subscription.state).toBe('trial');
    expect(view.body.usage.locations).toBe(1);
    expect((await write('onboarding', { ...body, slug: 'another' }, 'patient2')).status).toBe(409);
    expect(
      (
        await f.database.pool.query('SELECT 1 FROM memberships WHERE id=$1 AND clinic_id=$2', [
          user('patient2').membershipId,
          f.clinicId,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it.each(['dentist', 'receptionist', 'patient'])(
    'denies %s clinic administration but permits only their own preferences',
    async (role) => {
      await get('overview', role).expect(403);
      await get('audit', role).expect(403);
      expect((await write('locations', location('Unauthorized'), role)).status).toBe(403);
      expect(
        (await write('notification-preferences', { operationalEmail: false }, role, 'put')).status,
      ).toBe(200);
      await get('notification-preferences', role).expect(200).expect({ operationalEmail: false });
    },
  );
  it('separates owner-only export, audit and subscription control from admin configuration', async () => {
    await get('overview', 'clinic_admin').expect(200);
    await get('audit', 'clinic_admin').expect(403);
    expect((await write('exports', { reason: 'Fictional export' }, 'clinic_admin')).status).toBe(
      403,
    );
    expect(
      (
        await write(
          'subscription',
          { action: 'cancel', version: 1, reason: 'Fictional' },
          'clinic_admin',
        )
      ).status,
    ).toBe(403);
    const overview = (await get('overview').expect(200)).body;
    const body = {
      ...overview.configuration,
      displayName: 'Fictional renamed clinic',
      reason: 'Fictional rename',
    };
    delete body.clinicId;
    expect((await write('configuration', body, 'clinic_admin', 'put')).status).toBe(200);
    expect((await write('configuration', body, 'clinic_admin', 'put')).status).toBe(409);
    expect((await get('overview', 'foreign').expect(200)).body.configuration.displayName).toBe(
      'Fictional clinic',
    );
  });
  it('rejects cross-tenant locations, memberships, owner/self changes and patient promotion', async () => {
    expect(
      (await write('locations', { ...location('Foreign'), id: f.otherLocationId })).status,
    ).toBe(404);
    const change = { role: 'dentist', status: 'active', reason: 'Fictional role change' };
    for (const target of ['clinic_owner', 'patient'])
      expect(
        (await write(`members/${user(target).membershipId}`, change, 'clinic_owner', 'put')).status,
      ).toBe(403);
    expect(
      (await write(`members/${user('foreign').membershipId}`, change, 'clinic_owner', 'put'))
        .status,
    ).toBe(404);
    expect(
      (await write(`members/${user('clinic_admin').membershipId}`, change, 'clinic_admin', 'put'))
        .status,
    ).toBe(403);
  });
  it('serializes concurrent last-location growth and preserves limits when reactivating', async () => {
    await f.database.pool.query(
      "UPDATE clinic_subscriptions SET plan_code='starter' WHERE clinic_id=$1",
      [f.clinicId],
    );
    const responses = await Promise.all([
      write('locations', location('Concurrent A')),
      write('locations', location('Concurrent B')),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const rejected = responses.find((r) => r.status === 409)!;
    expect(rejected.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect((await get('overview').expect(200)).body.usage.locations).toBe(2);
    const added = responses.find((r) => r.status === 200)!.body;
    await write('locations', { ...added, active: false, reason: 'Fictional deactivate' });
    expect((await write('locations', location('Replacement'))).status).toBe(200);
    expect(
      (await write('locations', { ...added, active: true, reason: 'Fictional reactivate' })).status,
    ).toBe(409);
  });
  it('uses the production policy for grace and expiry, forbids self-activation and never creates subscription payments', async () => {
    const repo = new AdministrationRepository(f.database.pool, f.authOptions);
    const before = (await f.database.pool.query('SELECT count(*) FROM payments')).rows[0].count;
    await repo.administrativeGrant(
      f.clinicId,
      'team',
      'activate',
      'Fictional operator grant, no payment',
    );
    expect((await get('overview').expect(200)).body.subscription.effectiveState).toBe('active');
    await f.database.pool.query(
      "UPDATE clinic_subscriptions SET state='trial',period_end=now()-interval '1 hour',grace_end=now()+interval '1 hour' WHERE clinic_id=$1",
      [f.clinicId],
    );
    const grace = (await get('overview').expect(200)).body.subscription;
    expect(grace.effectiveState).toBe('grace');
    expect(
      (await f.database.pool.query('SELECT saas_growth_allowed($1) AS allowed', [f.clinicId]))
        .rows[0].allowed,
    ).toBe(grace.growthAllowed);
    await f.database.pool.query(
      "UPDATE clinic_subscriptions SET grace_end=now()-interval '1 minute' WHERE clinic_id=$1",
      [f.clinicId],
    );
    expect((await get('overview').expect(200)).body.subscription.growthAllowed).toBe(false);
    const denied = await write('locations', location('Expired'));
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
    expect(
      (await write('subscription', { action: 'activate', version: 1, reason: 'Fictional' })).status,
    ).toBe(400);
    expect((await f.database.pool.query('SELECT count(*) FROM payments')).rows[0].count).toBe(
      before,
    );
  });
  it('enforces optimistic subscription lifecycle and append-only events', async () => {
    const initial = (await get('overview').expect(200)).body.subscription;
    const cancel = await write('subscription', {
      action: 'cancel',
      version: initial.version,
      reason: 'Fictional scheduled cancellation',
    });
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelAtPeriodEnd).toBe(true);
    expect(cancel.body.growthAllowed).toBe(true);
    expect(
      (
        await write('subscription', {
          action: 'resume',
          version: initial.version,
          reason: 'Fictional stale version',
        })
      ).status,
    ).toBe(409);
    const resume = await write('subscription', {
      action: 'resume',
      version: cancel.body.version,
      reason: 'Fictional resumption',
    });
    expect(resume.status).toBe(200);
    expect(resume.body.cancelAtPeriodEnd).toBe(false);
    await expect(
      f.database.pool.query('DELETE FROM subscription_events WHERE clinic_id=$1', [f.clinicId]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      f.database.pool.query(
        'INSERT INTO notification_preferences(clinic_id,membership_id) VALUES($1,$2)',
        [f.clinicId, user('foreign').membershipId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    const session = (
      await f.database.pool.query('SELECT id,created_at FROM auth_sessions WHERE user_id=$1', [
        user('clinic_owner').userId,
      ])
    ).rows[0];
    await f.database.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '16 minutes' WHERE id=$1",
      [session.id],
    );
    try {
      await get(`export-files/${randomUUID()}`).expect(403);
    } finally {
      await f.database.pool.query('UPDATE auth_sessions SET created_at=$2 WHERE id=$1', [
        session.id,
        session.created_at,
      ]);
    }
  });
  it('changes roles without consuming another seat or granting clinician rights to patients', async () => {
    expect(
      (
        await mutation(
          f.app,
          f.origin,
          '/api/v1/access/select-membership',
          { membershipId: user('receptionist').membershipId },
          user('receptionist').cookie,
        )
      ).status,
    ).toBe(200);
    await f.database.pool.query(
      "UPDATE clinic_subscriptions SET state='suspended' WHERE clinic_id=$1",
      [f.clinicId],
    );
    const response = await write(
      `members/${user('receptionist').membershipId}`,
      { role: 'dentist', status: 'active', reason: 'Fictional approved role change' },
      'clinic_owner',
      'put',
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const result = await f.database.pool.query(
      'SELECT r.key FROM membership_roles mr JOIN roles r ON r.id=mr.role_id WHERE mr.membership_id=$1',
      [user('receptionist').membershipId],
    );
    expect(result.rows.map((r) => r.key)).toEqual(['dentist']);
    await request(f.app)
      .get('/api/v1/access/me')
      .set('cookie', user('receptionist').cookie)
      .expect(401);
  });
  it('enqueues invitations transactionally, hides tokens, and uses real retry/preference behavior', async () => {
    const sent: AuthMail[] = [];
    const provider = {
      name: 'test-real-adapter',
      send: async (message: AuthMail) => {
        sent.push(message);
        return { reference: null };
      },
    };
    const worker = new OutboxWorker(
      f.database.pool,
      pino({ level: 'silent' }),
      notificationHandlers(f.database.pool, provider, f.authOptions.secret),
      { pollIntervalMs: 1 },
    );
    const invite = await mutation(
      f.app,
      f.origin,
      '/api/v1/access/invitations',
      { email: 'newstaff@example.test', role: 'dentist' },
      user('clinic_owner').cookie,
    );
    expect(invite.status, JSON.stringify(invite.body)).toBe(200);
    const delivery = (
      await f.database.pool.query('SELECT * FROM notification_deliveries WHERE invitation_id=$1', [
        invite.body.id,
      ])
    ).rows[0];
    expect(delivery.encrypted_message).not.toContain('token=');
    const jobs = (
      await f.database.pool.query('SELECT payload FROM outbox_jobs WHERE aggregate_id=$1', [
        delivery.id,
      ])
    ).rows;
    expect(jobs).toEqual([{ payload: { deliveryId: delivery.id } }]);
    for (let i = 0; i < 10; i++) await worker.runOnce();
    expect(sent.some((m) => m.to === 'newstaff@example.test' && m.text.includes('token='))).toBe(
      true,
    );
    expect(JSON.stringify((await get('notifications').expect(200)).body)).not.toContain('token=');
    await write('notification-preferences', { operationalEmail: false }, 'clinic_owner', 'put');
    const db = await f.database.pool.connect();
    let id: string;
    try {
      await db.query('BEGIN');
      id = await enqueueNotification(
        db,
        f.clinicId,
        { to: user('clinic_owner').email, subject: 'Synthetic', text: 'Synthetic preference test' },
        f.authOptions.secret,
        { category: 'operational', membershipId: user('clinic_owner').membershipId },
      );
      await db.query('COMMIT');
    } finally {
      db.release();
    }
    await worker.runOnce();
    expect(
      (await f.database.pool.query('SELECT state FROM notification_deliveries WHERE id=$1', [id!]))
        .rows[0].state,
    ).toBe('skipped');
    const failed = await mutation(
      f.app,
      f.origin,
      '/api/v1/access/invitations',
      { email: 'retry@example.test', role: 'dentist' },
      user('clinic_owner').cookie,
    );
    expect(failed.status).toBe(200);
    const failing = new OutboxWorker(
      f.database.pool,
      pino({ level: 'silent' }),
      notificationHandlers(
        f.database.pool,
        {
          name: 'unavailable',
          send: async () => {
            throw new Error('Do not disclose credentials');
          },
        },
        f.authOptions.secret,
      ),
      { pollIntervalMs: 1, maxAttempts: 2 },
    );
    for (let i = 0; i < 4; i++) {
      await f.database.pool.query(
        "UPDATE outbox_jobs SET available_at=now() WHERE status='failed'",
      );
      await failing.runOnce();
    }
    const history = (
      await f.database.pool.query(
        'SELECT state,attempts,error_code FROM notification_deliveries WHERE invitation_id=$1',
        [failed.body.id],
      )
    ).rows[0];
    expect(history).toMatchObject({
      state: 'failed',
      attempts: 2,
      error_code: 'PROVIDER_UNAVAILABLE',
    });
    expect(
      (
        await f.database.pool.query(
          "SELECT count(*) FROM audit_events WHERE action='notification.failed'",
        )
      ).rows[0].count,
    ).toBe('2');
    const tx = await f.database.pool.connect();
    let rolledBack: string;
    try {
      await tx.query('BEGIN');
      rolledBack = await enqueueNotification(
        tx,
        f.clinicId,
        { to: 'rollback@example.test', subject: 'Synthetic', text: 'Never sent' },
        f.authOptions.secret,
        { category: 'operational' },
      );
      await tx.query('ROLLBACK');
    } finally {
      tx.release();
    }
    expect(
      (
        await f.database.pool.query('SELECT 1 FROM notification_deliveries WHERE id=$1', [
          rolledBack!,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it('exports only the owner tenant, excludes secrets, enforces fresh sessions and preserves data on offboarding', async () => {
    const foreignExport = await write(
      'exports',
      { reason: 'Fictional other-clinic export' },
      'foreign',
    );
    expect(foreignExport.status).toBe(200);
    const response = await write('exports', { reason: 'Fictional retention export' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const exported = response.body;
    expect(exported.tables.clinics).toHaveLength(1);
    expect(exported.tables.clinics[0].id).toBe(f.clinicId);
    expect(exported.tables).not.toHaveProperty('auth_sessions');
    expect(exported.tables).not.toHaveProperty('outbox_jobs');
    const json = JSON.stringify(exported);
    for (const secret of [
      'token_hash',
      'encrypted_message',
      'object_key',
      'password',
      'session_token',
      'token=',
    ])
      expect(json).not.toContain(secret);
    for (const rows of Object.values(exported.tables) as Record<string, unknown>[][])
      for (const row of rows) if (row['clinic_id']) expect(row['clinic_id']).toBe(f.clinicId);
    expect(exported.sha256).toBe(
      createHash('sha256')
        .update(JSON.stringify({ tables: exported.tables, files: exported.files }))
        .digest('hex'),
    );
    expect(
      (await write('offboarding/request', { reason: 'Fictional close' }, 'clinic_admin')).status,
    ).toBe(403);
    expect((await write('offboarding/request', { reason: 'Fictional close' })).status).toBe(200);
    expect(
      (
        await write('offboarding/complete', {
          reason: 'Fictional close',
          exportId: exported.id,
          confirmation: 'Wrong name',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await write('offboarding/complete', {
          reason: 'Fictional close',
          exportId: foreignExport.body.id,
          confirmation: exported.tables.clinics[0].display_name,
        })
      ).status,
    ).toBe(409);
    const count = (
      await f.database.pool.query('SELECT count(*) FROM patients WHERE clinic_id=$1', [f.clinicId])
    ).rows[0].count;
    expect(
      (
        await write('offboarding/complete', {
          reason: 'Fictional close',
          exportId: exported.id,
          confirmation: exported.tables.clinics[0].display_name,
        })
      ).status,
    ).toBe(200);
    await get('overview').expect(403);
    await get('overview', 'foreign').expect(200);
    expect(
      (
        await f.database.pool.query('SELECT count(*) FROM patients WHERE clinic_id=$1', [
          f.clinicId,
        ])
      ).rows[0].count,
    ).toBe(count);
    expect(
      (await f.database.pool.query('SELECT 1 FROM clinic_exports WHERE id=$1', [exported.id]))
        .rowCount,
    ).toBe(1);
    let limited;
    for (let i = 0; i < 3; i++)
      limited = await write('exports', { reason: 'Fictional rate-limit check' });
    expect(limited!.status).toBe(429);
    expect(limited!.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      requestId: expect.any(String),
    });
  });
});
