import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BillingCatalogSchema, BillingMutationSchema } from '@dentalai/contracts';
import {
  createSchedulingFixture,
  mutation,
  fixturePassword,
  responseCookies,
} from '../support/scheduling-fixture.js';
import { retryClinicalClock } from '../support/clinical-clock.js';
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('Disposable DATABASE_URL required.');
let f: Awaited<ReturnType<typeof createSchedulingFixture>>,
  priceListId: string,
  priceItemId: string,
  serviceId: string;
const post = (path: string, body: object, role = 'clinic_owner') =>
  mutation(f.app, f.origin, `/api/v1/billing/${path}`, body, f.members[role]!.cookie);
const get = (path: string, role = 'clinic_owner') =>
  request(f.app).get(`/api/v1/billing/${path}`).set('cookie', f.members[role]!.cookie);
const common = () => ({ reason: 'Fictional finance test', requestKey: randomUUID() });
const line = () => ({
  priceItemId,
  quantityHundredths: 100,
  discountMinor: 0,
  taxMinor: 0,
  procedureId: null,
  treatmentPlanItemId: null,
});
async function draft(patientId = f.patientId) {
  const r = await post('invoices', { patientId, priceListId, items: [line()], ...common() });
  expect(r.status, r.text).toBe(200);
  return BillingMutationSchema.parse(r.body).invoice;
}
async function issued() {
  const d = await draft();
  const r = await post(`invoices/${d.id}/issue`, { expectedVersion: d.version, ...common() });
  expect(r.status, r.text).toBe(200);
  return BillingMutationSchema.parse(r.body).invoice;
}
const payment = (id: string, amountMinor: number, key = randomUUID(), role = 'receptionist') =>
  post(
    `invoices/${id}/payments`,
    {
      amountMinor,
      currency: 'USD',
      method: 'cash',
      externalReference: null,
      reason: 'Fictional payment',
      requestKey: key,
    },
    role,
  );
beforeAll(async () => {
  f = await createSchedulingFixture(url);
  expect(
    (
      await post('services', {
        code: 'PHASE9',
        name: 'Fictional service',
        reason: 'Fictional catalog',
      })
    ).status,
  ).toBe(200);
  serviceId = BillingCatalogSchema.parse((await get('catalog')).body).services.find(
    (s) => s.code === 'PHASE9',
  )!.id;
  expect(
    (
      await post('price-lists', {
        name: 'Fictional prices',
        currency: 'USD',
        items: [{ serviceId, amountMinor: 10000 }],
        reason: 'Fictional publish',
      })
    ).status,
  ).toBe(200);
  const list = BillingCatalogSchema.parse((await get('catalog')).body).priceLists[0]!;
  priceListId = list.id;
  priceItemId = list.items[0]!.id;
});
beforeEach(async () => {
  await f.database.pool.query('DELETE FROM auth_rate_limits');
});
afterAll(async () => {
  if (f) await f.dispose();
});
describe('billing production API and PostgreSQL ledger', () => {
  it('rejects unaudited draft transitions and orphan payments/refunds at database commit', async () => {
    const d = await draft();
    await expect(
      f.database.pool.query(
        "UPDATE invoices SET status='issued',issued_at=clock_timestamp() WHERE id=$1",
        [d.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      f.database.pool.query(
        'UPDATE billing_invoice_workflows SET version=version+1 WHERE invoice_id=$1',
        [d.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const i = await issued();
    await expect(
      f.database.pool.query(
        "INSERT INTO payments(clinic_id,patient_id,invoice_id,status,method,amount_minor,currency,received_at,recorded_by_membership_id) VALUES($1,$2,$3,'succeeded','cash',1,'USD',clock_timestamp(),$4)",
        [f.clinicId, f.patientId, i.id, f.members['clinic_owner']!.membershipId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const p = await payment(i.id, 100);
    const paymentId = p.body.invoice.events.find(
      (e: { kind: string }) => e.kind === 'payment',
    ).paymentId;
    await expect(
      f.database.pool.query(
        "INSERT INTO refunds(clinic_id,payment_id,status,amount_minor,currency,reason,refunded_at,recorded_by_membership_id) VALUES($1,$2,'succeeded',1,'USD','Fictional orphan',clock_timestamp(),$3)",
        [f.clinicId, paymentId, f.members['clinic_owner']!.membershipId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (await f.database.pool.query('SELECT amount_minor FROM payments WHERE invoice_id=$1', [i.id]))
        .rows,
    ).toHaveLength(1);
  });
  it('requires explicit approved clinical links and rejects foreign patient sources', async () => {
    for (const items of [
      [{ ...line(), procedureId: randomUUID() }],
      [{ ...line(), treatmentPlanItemId: randomUUID() }],
    ])
      expect(
        (await post('invoices', { patientId: f.patientId, priceListId, items, ...common() }))
          .status,
      ).toBe(404);
    expect((await get(`patients/${f.patientId}/links`, 'patient')).status).toBe(403);
  });
  it('links approved performed procedures and plan items without deriving amounts from clinical state', async () => {
    const clinical = async (path: string, body: object) => {
      const r = await retryClinicalClock(f.database.pool, () =>
        mutation(f.app, f.origin, `/api/v1/clinical/${path}`, body, f.members['dentist']!.cookie),
      );
      expect(r.status, r.text).toBe(200);
      return r.body as { id: string };
    };
    const encounter = await clinical(`patients/${f.patientId}/encounters`, {
      appointmentId: null,
      reason: 'Fictional billing visit',
    });
    const planned = await clinical(`patients/${f.patientId}/records`, {
      encounterId: encounter.id,
      supersedesId: null,
      reason: 'Fictional performed procedure',
      data: {
        kind: 'procedure',
        toothCode: '16',
        surfaces: ['O'],
        procedureCode: 'restoration',
        description: 'Fictional restoration',
        status: 'planned',
      },
    });
    const procedure = await clinical(`patients/${f.patientId}/records`, {
      encounterId: encounter.id,
      supersedesId: planned.id,
      reason: 'Fictional performed procedure',
      data: {
        kind: 'procedure',
        toothCode: '16',
        surfaces: ['O'],
        procedureCode: 'restoration',
        description: 'Fictional restoration',
        status: 'completed',
      },
    });
    const draftBody = {
      patientId: f.patientId,
      priceListId,
      items: [{ ...line(), procedureId: procedure.id }],
      ...common(),
    };
    expect((await post('invoices', draftBody)).status).toBe(404);
    await clinical(`records/${procedure.id}/review`, {
      decision: 'approved',
      reason: 'Fictional approved procedure',
    });
    const plan = await clinical(`patients/${f.patientId}/records`, {
      encounterId: encounter.id,
      supersedesId: null,
      reason: 'Fictional plan',
      data: {
        kind: 'plan',
        name: 'Fictional approved plan',
        status: 'draft',
        items: [
          {
            serviceId,
            toothCode: '16',
            surfaces: ['O'],
            description: 'Fictional planned restoration',
            quantity: 1,
            estimatedAmountMinor: 1,
            currency: 'USD',
            status: 'planned',
          },
        ],
      },
    });
    await clinical(`records/${plan.id}/review`, {
      decision: 'approved',
      reason: 'Fictional approved plan',
    });
    const links = (await get(`patients/${f.patientId}/links`)).body as {
      id: string;
      kind: string;
    }[];
    const planItemId = links.find((l) => l.kind === 'plan_item')!.id;
    const created = await post('invoices', {
      ...draftBody,
      requestKey: randomUUID(),
      items: [{ ...line(), procedureId: procedure.id, treatmentPlanItemId: planItemId }],
    });
    expect(created.status, created.text).toBe(200);
    expect(created.body.invoice.originalTotalMinor).toBe(10000);
    expect(created.body.invoice.items[0].treatmentPlanItemId).toBe(planItemId);
    expect(
      (
        await post('invoices', {
          patientId: f.secondPatientId,
          priceListId,
          items: [{ ...line(), procedureId: procedure.id, treatmentPlanItemId: planItemId }],
          ...common(),
        })
      ).status,
    ).toBe(404);
  });
  it('revalidates membership, clinic activity and revoked sessions for financial operations', async () => {
    const i = await issued();
    const owner = f.members['clinic_owner']!;
    await f.database.pool.query("UPDATE memberships SET status='suspended' WHERE id=$1", [
      owner.membershipId,
    ]);
    try {
      expect([401, 403]).toContain((await payment(i.id, 1, randomUUID(), 'clinic_owner')).status);
    } finally {
      await f.database.pool.query("UPDATE memberships SET status='active' WHERE id=$1", [
        owner.membershipId,
      ]);
    }
    await f.database.pool.query('UPDATE clinics SET active=false WHERE id=$1', [f.clinicId]);
    try {
      expect([401, 403]).toContain((await get('invoices')).status);
    } finally {
      await f.database.pool.query('UPDATE clinics SET active=true WHERE id=$1', [f.clinicId]);
    }
    const session = (
      await f.database.pool.query('SELECT id FROM auth_sessions WHERE user_id=$1 LIMIT 1', [
        f.members['receptionist']!.userId,
      ])
    ).rows[0];
    await f.database.pool.query(
      "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE id=$1 RETURNING id",
      [session.id],
    );
    expect((await payment(i.id, 1, randomUUID(), 'receptionist')).status).toBe(401);
    const login = await mutation(
      f.app,
      f.origin,
      '/api/v1/auth/sign-in/email',
      { email: f.members['receptionist']!.email, password: fixturePassword },
      '',
    );
    expect(login.status, login.text).toBe(200);
    f.members['receptionist']!.cookie = responseCookies(login).join('; ');
  });
  it('keeps drafts private, issues snapshots and refuses editing after issue', async () => {
    const d = await draft();
    expect((await get('portal', 'patient')).body.some((i: { id: string }) => i.id === d.id)).toBe(
      false,
    );
    const revision = await post(`invoices/${d.id}/draft`, {
      priceListId,
      items: [{ ...line(), quantityHundredths: 50, taxMinor: 1 }],
      expectedVersion: d.version,
      ...common(),
    });
    expect(revision.status, revision.text).toBe(200);
    const v = BillingMutationSchema.parse(revision.body).invoice;
    expect(v.originalTotalMinor).toBe(5001);
    expect(
      (await post(`invoices/${d.id}/issue`, { expectedVersion: d.version, ...common() })).status,
    ).toBe(409);
    expect(
      (await post(`invoices/${d.id}/issue`, { expectedVersion: v.version, ...common() })).status,
    ).toBe(200);
    expect(
      (
        await post(`invoices/${d.id}/draft`, {
          priceListId,
          items: [line()],
          expectedVersion: v.version,
          ...common(),
        })
      ).status,
    ).toBe(409);
    const p = (await get('portal', 'patient')).body.find((i: { id: string }) => i.id === d.id);
    expect(p.balanceMinor).toBe(5001);
    expect(p.events.every((e: object) => !('reason' in e))).toBe(true);
  });
  it('discards drafts as an audited retained transition, never a deletion', async () => {
    const d = await draft();
    const r = await post(`invoices/${d.id}/discard`, { expectedVersion: d.version, ...common() });
    expect(r.status, r.text).toBe(200);
    expect(r.body.invoice.status).toBe('discarded');
    expect((await post(`invoices/${d.id}/issue`, { expectedVersion: 2, ...common() })).status).toBe(
      409,
    );
    expect(
      (await f.database.pool.query('SELECT id FROM invoices WHERE id=$1', [d.id])).rowCount,
    ).toBe(1);
  });
  it('reconciles partial payments, refunds and debit/credit adjustments with immutable receipts', async () => {
    const i = await issued();
    const p = await payment(i.id, 4000);
    expect(p.status, p.text).toBe(200);
    expect(p.body.invoice.balanceMinor).toBe(6000);
    expect(p.body.receiptReference).toMatch(/^REC-/);
    const paymentId = p.body.invoice.events.find(
      (e: { kind: string }) => e.kind === 'payment',
    ).paymentId;
    expect((await payment(i.id, 6001)).status).toBe(409);
    const refund = await post(`invoices/${i.id}/refunds`, {
      paymentId,
      amountMinor: 1000,
      currency: 'USD',
      externalReference: null,
      ...common(),
    });
    expect(refund.status, refund.text).toBe(200);
    expect(refund.body.invoice.balanceMinor).toBe(7000);
    expect(refund.body.receiptReference).toMatch(/^REF-/);
    const credit = await post(`invoices/${i.id}/adjustments`, {
      amountMinor: -2000,
      currency: 'USD',
      ...common(),
    });
    expect(credit.status, credit.text).toBe(200);
    expect(credit.body.invoice.adjustedTotalMinor).toBe(8000);
    expect(credit.body.invoice.balanceMinor).toBe(5000);
    const paid = await payment(i.id, 5000);
    expect(paid.status, paid.text).toBe(200);
    expect(paid.body.invoice.status).toBe('paid');
    expect(
      (
        await post(`invoices/${i.id}/adjustments`, {
          amountMinor: -1,
          currency: 'USD',
          ...common(),
        })
      ).status,
    ).toBe(409);
    const debit = await post(`invoices/${i.id}/adjustments`, {
      amountMinor: 500,
      currency: 'USD',
      ...common(),
    });
    expect(debit.body.invoice.balanceMinor).toBe(500);
    expect(
      debit.body.invoice.adjustedTotalMinor -
        debit.body.invoice.paymentsMinor +
        debit.body.invoice.refundsMinor,
    ).toBe(debit.body.invoice.balanceMinor);
    expect(
      (
        await post(`invoices/${i.id}/refunds`, {
          paymentId,
          amountMinor: 3001,
          currency: 'USD',
          externalReference: null,
          ...common(),
        })
      ).status,
    ).toBe(409);
  });
  it('serializes concurrent payments and refunds and replays identical requests once', async () => {
    const i = await issued();
    const rs = await Promise.all([payment(i.id, 7000), payment(i.id, 7000)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const key = randomUUID();
    const body = {
      amountMinor: 1000,
      currency: 'USD',
      method: 'cash',
      externalReference: null,
      reason: 'Fictional payment',
      requestKey: key,
    };
    const replies = await Promise.all([
      post(`invoices/${i.id}/payments`, body),
      post(`invoices/${i.id}/payments`, body),
    ]);
    expect(replies.map((r) => r.status)).toEqual([200, 200]);
    expect(replies[0]!.body.receiptReference).toBe(replies[1]!.body.receiptReference);
    expect((await post(`invoices/${i.id}/payments`, { ...body, amountMinor: 999 })).status).toBe(
      409,
    );
    const paymentId = replies[0]!.body.invoice.events.find(
      (e: { kind: string; amountMinor: number }) => e.kind === 'payment' && e.amountMinor === -1000,
    ).paymentId;
    const refunds = await Promise.all(
      [1, 2].map(() =>
        post(`invoices/${i.id}/refunds`, {
          paymentId,
          amountMinor: 700,
          currency: 'USD',
          externalReference: null,
          ...common(),
        }),
      ),
    );
    expect(refunds.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it.each(['patient', 'patient2', 'dentist'])('denies financial writes to %s', async (role) => {
    const i = await issued();
    for (const [path, body] of [
      ['invoices', { patientId: f.patientId, priceListId, items: [line()], ...common() }],
      [
        `invoices/${i.id}/payments`,
        { amountMinor: 1, currency: 'USD', method: 'cash', externalReference: null, ...common() },
      ],
      [
        `invoices/${i.id}/refunds`,
        {
          paymentId: randomUUID(),
          amountMinor: 1,
          currency: 'USD',
          externalReference: null,
          ...common(),
        },
      ],
      [`invoices/${i.id}/adjustments`, { amountMinor: 1, currency: 'USD', ...common() }],
      ['services', { code: randomUUID(), name: 'Fictional', reason: 'Fictional' }],
      [
        'price-lists',
        {
          name: 'Fictional',
          currency: 'USD',
          items: [{ serviceId, amountMinor: 1 }],
          reason: 'Fictional',
        },
      ],
    ] as const)
      expect((await post(path, body, role)).status).toBe(403);
  });
  it('permits admin billing, denies receptionist refunds/pricing and keeps patient views scoped', async () => {
    const i = await issued();
    expect((await payment(i.id, 100, randomUUID(), 'clinic_admin')).status).toBe(200);
    expect((await get('catalog', 'dentist')).status).toBe(200);
    expect((await get('catalog', 'patient')).status).toBe(403);
    expect((await get('portal', 'patient2')).body.some((v: { id: string }) => v.id === i.id)).toBe(
      false,
    );
    expect((await get('portal?patientId=' + f.patientId, 'patient2')).status).toBe(400);
    expect(
      (
        await post(
          'services',
          { code: 'BAD', name: 'Fictional', reason: 'Fictional' },
          'receptionist',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          `invoices/${i.id}/adjustments`,
          { amountMinor: 1, currency: 'USD', ...common() },
          'receptionist',
        )
      ).status,
    ).toBe(403);
  });
  it('denies cross-clinic resources and price/patient sources', async () => {
    const i = await issued();
    for (const [path, body] of [
      [
        `invoices/${i.id}/payments`,
        { amountMinor: 1, currency: 'USD', method: 'cash', externalReference: null, ...common() },
      ],
      [`invoices/${i.id}/issue`, { expectedVersion: 1, ...common() }],
      [
        `invoices/${i.id}/refunds`,
        {
          paymentId: randomUUID(),
          amountMinor: 1,
          currency: 'USD',
          externalReference: null,
          ...common(),
        },
      ],
      [`invoices/${i.id}/adjustments`, { amountMinor: 1, currency: 'USD', ...common() }],
    ] as const)
      expect((await post(path, body, 'foreign')).status).toBe(404);
    expect(
      (
        await post('invoices', {
          patientId: f.foreignPatientId,
          priceListId,
          items: [line()],
          ...common(),
        })
      ).status,
    ).toBe(404);
    expect((await get(`patients/${f.foreignPatientId}/links`)).status).toBe(404);
  });
  it('rejects malformed money and authority overrides, and enforces currency', async () => {
    const i = await issued();
    for (const amountMinor of [0, -1, 1.1, '1e2', 'NaN', null])
      expect(
        (
          await post(`invoices/${i.id}/payments`, {
            amountMinor,
            currency: 'USD',
            method: 'cash',
            externalReference: null,
            ...common(),
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await post(`invoices/${i.id}/payments`, {
          amountMinor: 1,
          currency: 'EUR',
          method: 'cash',
          externalReference: null,
          ...common(),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await post(`invoices/${i.id}/payments`, {
          amountMinor: 1,
          currency: 'USD',
          method: 'cash',
          externalReference: null,
          clinicId: f.otherClinicId,
          ...common(),
        })
      ).status,
    ).toBe(400);
  });
  it('rolls back financial events and payment rows on audit failure with safe errors', async () => {
    const i = await issued();
    await f.database.pool.query(
      "CREATE FUNCTION reject_phase9_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.payment' THEN RAISE EXCEPTION 'fictional secret db failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_phase9_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_phase9_audit()",
    );
    try {
      const r = await payment(i.id, 100);
      expect(r.status).toBe(503);
      expect(r.text).not.toContain('fictional secret db failure');
      expect(
        (await f.database.pool.query('SELECT id FROM payments WHERE invoice_id=$1', [i.id]))
          .rowCount,
      ).toBe(0);
    } finally {
      await f.database.pool.query(
        'DROP TRIGGER reject_phase9_audit ON audit_events; DROP FUNCTION reject_phase9_audit()',
      );
    }
  });
  it('enforces issued invoice, payment, ledger and published price immutability in SQL', async () => {
    const i = await issued();
    const p = await payment(i.id, 100);
    expect(p.status, p.text).toBe(200);
    for (const [sql, id] of [
      ['UPDATE invoices SET total_minor=0 WHERE id=$1', i.id],
      ['DELETE FROM invoices WHERE id=$1', i.id],
      ['DELETE FROM invoice_items WHERE invoice_id=$1', i.id],
      ['DELETE FROM billing_ledger WHERE invoice_id=$1', i.id],
      ['DELETE FROM payments WHERE invoice_id=$1', i.id],
      ['UPDATE price_list_items SET amount_minor=1 WHERE id=$1', priceItemId],
    ] as const)
      await expect(f.database.pool.query(sql, [id])).rejects.toMatchObject({ code: '55000' });
  });
  it('reports only issued invoice events and reconciles by currency', async () => {
    await draft();
    const r = await get('reports');
    expect(r.status, r.text).toBe(200);
    for (const row of r.body)
      expect(row.adjustedTotalMinor - row.paymentsMinor + row.refundsMinor).toBe(row.balanceMinor);
    const sql = (
      await f.database.pool.query(
        "SELECT COALESCE(sum(l.amount_minor),0)::text AS amount FROM billing_ledger l JOIN invoices i ON i.id=l.invoice_id AND i.clinic_id=l.clinic_id WHERE i.clinic_id=$1 AND i.status<>'draft'",
        [f.clinicId],
      )
    ).rows[0];
    expect(r.body.reduce((s: number, v: { balanceMinor: number }) => s + v.balanceMinor, 0)).toBe(
      Number(sql.amount),
    );
  });
});
