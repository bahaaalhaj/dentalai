import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  BillingInvoiceSchema,
  BillingCatalogSchema,
  BillingEventSchema,
  type BillingInvoice,
  type BillingLineInput,
  type InvoiceWriteSchema,
  type DraftReplaceSchema,
  type InvoiceActionSchema,
  type PaymentWriteSchema,
  type RefundWriteSchema,
  type AdjustmentWriteSchema,
  type PricingWriteSchema,
  type ServiceWriteSchema,
} from '@dentalai/contracts';
import { boundedMinor, lineAmount, sumMinor, parseMoney } from '@dentalai/domain';
import { DomainError, DependencyUnavailableError } from '../../errors/domain-errors.js';
import type { AccessContext } from '../access/access.repository.js';
type Access = {
  clinicId: string;
  membershipId: string;
  manage: boolean;
  write: boolean;
  patient: boolean;
};
type InvoiceRow = {
  id: string;
  patient_id: string;
  invoice_number: string;
  status: string;
  currency: string;
  total_minor: string;
  issued_at: Date | null;
  version: number;
  discarded_at: Date | null;
};
type EventRow = {
  id: string;
  invoice_id: string;
  kind: string;
  amount_minor: string;
  currency: string;
  recorded_at: Date;
  receipt_reference: string | null;
  payment_id: string | null;
  refund_id: string | null;
  method: string | null;
  reason: string;
  operation_hash: string;
};
type Operation =
  | z.infer<typeof InvoiceActionSchema>
  | z.infer<typeof PaymentWriteSchema>
  | z.infer<typeof RefundWriteSchema>
  | z.infer<typeof AdjustmentWriteSchema>
  | z.infer<typeof DraftReplaceSchema>;
const denied = () => new DomainError('ACCESS_DENIED', 'Billing access denied.', 403);
const missing = () =>
  new DomainError('NOT_FOUND', 'Invoice, patient or billing source not found.', 404);
const conflict = (message = 'Billing changed. Refresh before retrying.') =>
  new DomainError('BILLING_CONFLICT', message, 409);
const invalid = (message: string) => new DomainError('INVALID_BILLING', message, 422);
const minor = (value: string) => boundedMinor(BigInt(value));
const aggregate = (value: bigint) => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount))
    throw new DomainError(
      'REPORT_LIMIT',
      'Financial aggregate exceeds the supported reporting limit.',
      503,
    );
  return amount;
};

export class BillingRepository {
  constructor(readonly pool: Pool) {}
  private async transaction<T>(
    context: AccessContext,
    mode: 'read' | 'write' | 'manage' | 'patient',
    fn: (db: PoolClient, a: Access) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect().catch(() => {
      throw new DependencyUnavailableError();
    });
    try {
      await db.query('BEGIN');
      const m = context.membership;
      if (!m) throw denied();
      await db.query('SELECT saas_lock($1)', [m.clinicId]);
      const roles = await db.query<{ key: string }>(
        `SELECT r.key FROM memberships m JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL JOIN clinics c ON c.id=m.clinic_id AND c.active
        JOIN auth_sessions s ON s.id=$3 AND s.user_id=u.id AND s.expires_at>now()
        JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id
        WHERE m.id=$1 AND m.clinic_id=$2 AND m.user_id=$4 AND m.status='active' AND (s.active_membership_id IS NULL OR s.active_membership_id=m.id) FOR SHARE OF m,u,c,s,mr,r`,
        [m.id, m.clinicId, context.sessionId, context.userId],
      );
      const keys = roles.rows.map((r) => r.key),
        manage = keys.some((r) => ['clinic_owner', 'clinic_admin'].includes(r)),
        write = manage || keys.includes('receptionist');
      const a = {
        clinicId: m.clinicId,
        membershipId: m.id,
        manage,
        write,
        patient: keys.includes('patient'),
      };
      if (
        !roles.rowCount ||
        !(mode === 'patient'
          ? a.patient
          : mode === 'manage'
            ? manage
            : mode === 'write'
              ? write
              : write || keys.includes('dentist'))
      )
        throw denied();
      const result = await fn(db, a);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error) {
        if (['23505', '40001', '40P01'].includes(String(error.code))) throw conflict();
        if (/^(08|53|57|P0001)/.test(String(error.code))) throw new DependencyUnavailableError();
      }
      throw error;
    } finally {
      db.release();
    }
  }
  private async audit(
    db: PoolClient,
    c: AccessContext,
    a: Access,
    action: string,
    id: string,
    reason: string,
    before: unknown,
    after: unknown,
    patientId?: string,
    invoiceId?: string,
  ) {
    await db.query(
      `INSERT INTO audit_events(clinic_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,request_id,data,occurred_at) VALUES($1,$2,$3,$4,'billing',$5,$6,$7::jsonb,clock_timestamp())`,
      [
        a.clinicId,
        c.userId,
        a.membershipId,
        action,
        id,
        c.requestId,
        JSON.stringify({
          reason,
          before,
          after,
          ...(patientId ? { patientId } : {}),
          ...(invoiceId ? { invoiceId } : {}),
        }),
      ],
    );
  }
  private async row(db: PoolClient, a: Access, id: string): Promise<InvoiceRow> {
    const r = await db.query<InvoiceRow>(
      `SELECT i.*,w.version,w.discarded_at FROM invoices i JOIN billing_invoice_workflows w ON w.clinic_id=i.clinic_id AND w.invoice_id=i.id WHERE i.clinic_id=$1 AND i.id=$2 FOR UPDATE OF i,w`,
      [a.clinicId, id],
    );
    if (!r.rows[0]) throw missing();
    return r.rows[0];
  }
  private async project(
    db: PoolClient,
    a: Access,
    id: string,
    patient = false,
  ): Promise<BillingInvoice> {
    const r = await this.row(db, a, id);
    const events = await db.query<EventRow>(
      `SELECT l.*,p.method FROM billing_ledger l LEFT JOIN payments p ON p.clinic_id=l.clinic_id AND p.id=l.payment_id WHERE l.clinic_id=$1 AND l.invoice_id=$2 ORDER BY l.recorded_at,l.id`,
      [a.clinicId, id],
    );
    const monetary = events.rows.filter((e) => !e.kind.startsWith('draft_'));
    const adjusted =
      r.status === 'draft'
        ? minor(r.total_minor)
        : sumMinor(
            monetary
              .filter((e) => ['invoice_issued', 'adjustment'].includes(e.kind))
              .map((e) => minor(e.amount_minor)),
          );
    const payments = aggregate(
      -events.rows
        .filter((e) => e.kind === 'payment')
        .reduce((sum, e) => sum + BigInt(e.amount_minor), 0n),
    );
    const refunds = aggregate(
      events.rows
        .filter((e) => e.kind === 'refund')
        .reduce((sum, e) => sum + BigInt(e.amount_minor), 0n),
    );
    const balance = r.status === 'draft' ? 0 : sumMinor(monetary.map((e) => minor(e.amount_minor)));
    const items = await db.query<{
      id: string;
      description: string;
      quantity: string;
      unit_amount_minor: string;
      discount_minor: string;
      tax_minor: string;
      line_total_minor: string;
      procedure_id: string | null;
      treatment_plan_item_id: string | null;
    }>(
      `SELECT i.*,l.treatment_plan_item_id FROM invoice_items i LEFT JOIN billing_item_links l ON l.clinic_id=i.clinic_id AND l.item_id=i.id WHERE i.clinic_id=$1 AND i.invoice_id=$2 ORDER BY i.created_at,i.id`,
      [a.clinicId, id],
    );
    return BillingInvoiceSchema.parse({
      id: r.id,
      patientId: r.patient_id,
      invoiceNumber: r.invoice_number,
      currency: r.currency,
      version: r.version,
      issuedAt: r.issued_at?.toISOString() ?? null,
      status: r.discarded_at
        ? 'discarded'
        : r.status === 'draft'
          ? 'draft'
          : balance === 0
            ? 'paid'
            : payments - refunds > 0
              ? 'partially_paid'
              : 'issued',
      originalTotalMinor: minor(r.total_minor),
      adjustedTotalMinor: adjusted,
      paymentsMinor: payments,
      refundsMinor: refunds,
      balanceMinor: balance,
      items: items.rows.map((i) => ({
        id: i.id,
        description: i.description,
        quantityHundredths: parseMoney(i.quantity, 2),
        unitAmountMinor: minor(i.unit_amount_minor),
        discountMinor: minor(i.discount_minor),
        taxMinor: minor(i.tax_minor),
        lineTotalMinor: minor(i.line_total_minor),
        procedureId: i.procedure_id,
        treatmentPlanItemId: i.treatment_plan_item_id,
      })),
      events: events.rows
        .filter((e) => !patient || !e.kind.startsWith('draft_'))
        .map((e) =>
          BillingEventSchema.parse({
            id: e.id,
            kind: e.kind,
            amountMinor: minor(e.amount_minor),
            currency: e.currency,
            recordedAt: e.recorded_at.toISOString(),
            receiptReference: e.receipt_reference,
            paymentId: e.payment_id,
            refundId: e.refund_id,
            method: e.method,
            ...(!patient ? { reason: e.reason } : {}),
          }),
        ),
    });
  }
  async catalog(c: AccessContext) {
    return this.transaction(c, 'read', async (db, a) => {
      const services = (
        await db.query(
          'SELECT id,code,name,active FROM services WHERE clinic_id=$1 ORDER BY name',
          [a.clinicId],
        )
      ).rows;
      const lists = (
        await db.query<{ id: string; name: string; currency: string }>(
          `SELECT p.id,p.name,p.currency FROM price_lists p JOIN billing_price_publications b ON b.clinic_id=p.clinic_id AND b.price_list_id=p.id WHERE p.clinic_id=$1 ORDER BY p.effective_from DESC,p.id`,
          [a.clinicId],
        )
      ).rows;
      const priceLists = [];
      for (const l of lists) {
        const items = await db.query<{
          id: string;
          serviceId: string;
          serviceName: string;
          amount_minor: string;
        }>(
          `SELECT p.id,p.service_id AS "serviceId",s.name AS "serviceName",p.amount_minor FROM price_list_items p JOIN services s ON s.clinic_id=p.clinic_id AND s.id=p.service_id WHERE p.clinic_id=$1 AND p.price_list_id=$2 ORDER BY s.name`,
          [a.clinicId, l.id],
        );
        priceLists.push({
          ...l,
          items: items.rows.map((i) => ({
            id: i.id,
            serviceId: i.serviceId,
            serviceName: i.serviceName,
            amountMinor: minor(i.amount_minor),
          })),
        });
      }
      const patients = (
        await db.query(
          `SELECT id,given_name AS "givenName",family_name AS "familyName",medical_record_number AS "medicalRecordNumber" FROM patients WHERE clinic_id=$1 ORDER BY family_name,id LIMIT 500`,
          [a.clinicId],
        )
      ).rows;
      return BillingCatalogSchema.parse({
        services,
        priceLists,
        patients,
        permissions: { write: a.write, manage: a.manage },
      });
    });
  }
  async list(c: AccessContext, portal = false) {
    return this.transaction(c, portal ? 'patient' : 'read', async (db, a) => {
      // Derive ownership from the session; patients cannot select patient/clinic IDs.
      const rows = await db.query<{ id: string }>(
        `SELECT i.id FROM invoices i JOIN billing_invoice_workflows w ON w.clinic_id=i.clinic_id AND w.invoice_id=i.id JOIN patients p ON p.clinic_id=i.clinic_id AND p.id=i.patient_id WHERE i.clinic_id=$1 AND (NOT $2::boolean OR (p.portal_user_id=$3 AND i.status<>'draft')) ORDER BY i.id`,
        [a.clinicId, portal, c.userId],
      );
      const invoices = [];
      for (const r of rows.rows) invoices.push(await this.project(db, a, r.id, portal));
      return invoices;
    });
  }
  async links(c: AccessContext, patientId: string) {
    return this.transaction(c, 'read', async (db, a) => {
      if (
        !(
          await db.query('SELECT 1 FROM patients WHERE clinic_id=$1 AND id=$2', [
            a.clinicId,
            patientId,
          ])
        ).rowCount
      )
        throw missing();
      return (
        await db.query(
          `SELECT p.id,'procedure' AS kind,p.description FROM procedures p JOIN clinical_approvals a ON a.clinic_id=p.clinic_id AND a.revision_id=p.id AND a.decision='approved' WHERE p.clinic_id=$1 AND p.patient_id=$2 AND p.status='completed'
      UNION ALL SELECT i.id,'plan_item' AS kind,i.description FROM treatment_plan_items i JOIN treatment_plans p ON p.clinic_id=i.clinic_id AND p.id=i.treatment_plan_id JOIN clinical_approvals a ON a.clinic_id=p.clinic_id AND a.revision_id=p.id AND a.decision='approved' WHERE p.clinic_id=$1 AND p.patient_id=$2`,
          [a.clinicId, patientId],
        )
      ).rows;
    });
  }
  async service(c: AccessContext, body: z.infer<typeof ServiceWriteSchema>) {
    return this.transaction(c, 'manage', async (db, a) => {
      const r = (
        await db.query(
          'INSERT INTO services(clinic_id,code,name) VALUES($1,$2,$3) RETURNING id,code,name,active',
          [a.clinicId, body.code, body.name],
        )
      ).rows[0];
      await this.audit(db, c, a, 'billing.service_created', String(r.id), body.reason, null, r);
      return { success: true as const };
    });
  }
  async pricing(c: AccessContext, body: z.infer<typeof PricingWriteSchema>) {
    return this.transaction(c, 'manage', async (db, a) => {
      // Validate an actual ISO currency supported by the runtime, not arbitrary invented codes.
      if (!Intl.supportedValuesOf('currency').includes(body.currency))
        throw invalid('Unsupported currency code.');
      const list = (
        await db.query<{ id: string }>(
          `INSERT INTO price_lists(clinic_id,name,currency,effective_from) VALUES($1,$2,$3,clock_timestamp()) RETURNING id`,
          [a.clinicId, body.name, body.currency],
        )
      ).rows[0]!;
      for (const i of body.items) {
        if (
          !(
            await db.query(
              'SELECT 1 FROM services WHERE clinic_id=$1 AND id=$2 AND active FOR SHARE',
              [a.clinicId, i.serviceId],
            )
          ).rowCount
        )
          throw missing();
        await db.query(
          'INSERT INTO price_list_items(clinic_id,price_list_id,service_id,amount_minor,currency) VALUES($1,$2,$3,$4,$5)',
          [a.clinicId, list.id, i.serviceId, i.amountMinor, body.currency],
        );
      }
      await db.query(
        'INSERT INTO billing_price_publications(price_list_id,clinic_id,currency,author_membership_id,reason) VALUES($1,$2,$3,$4,$5)',
        [list.id, a.clinicId, body.currency, a.membershipId, body.reason],
      );
      await this.audit(db, c, a, 'billing.price_published', list.id, body.reason, null, body);
      return { success: true as const };
    });
  }
  private hash(a: Access, kind: string, target: string, body: object) {
    return createHash('sha256')
      .update(JSON.stringify({ actor: a.membershipId, kind, target, body }))
      .digest('hex');
  }
  private async replay(db: PoolClient, a: Access, key: string, hash: string) {
    const e = (
      await db.query<EventRow>(
        'SELECT * FROM billing_ledger WHERE clinic_id=$1 AND request_key=$2',
        [a.clinicId, key],
      )
    ).rows[0];
    if (!e) return null;
    if (e.operation_hash !== hash)
      throw conflict('Idempotency key was already used for a different operation.');
    return {
      invoice: await this.project(db, a, e.invoice_id),
      receiptReference: e.receipt_reference,
    };
  }
  private async record(
    db: PoolClient,
    c: AccessContext,
    a: Access,
    invoiceId: string,
    kind: string,
    amount: number,
    body: { reason: string; requestKey: string },
    hash: string,
    before: unknown,
    paymentId: string | null = null,
    refundId: string | null = null,
  ) {
    const r = await this.row(db, a, invoiceId),
      id = randomUUID(),
      receipt = ['payment', 'refund'].includes(kind)
        ? `${kind === 'payment' ? 'REC' : 'REF'}-${id}`
        : null;
    await db.query(
      `INSERT INTO billing_ledger(id,clinic_id,invoice_id,kind,amount_minor,currency,payment_id,refund_id,receipt_reference,author_membership_id,reason,request_key,operation_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        a.clinicId,
        invoiceId,
        kind,
        amount,
        r.currency,
        paymentId,
        refundId,
        receipt,
        a.membershipId,
        body.reason,
        body.requestKey,
        hash,
      ],
    );
    const invoice = await this.project(db, a, invoiceId);
    await this.audit(
      db,
      c,
      a,
      `billing.${kind}`,
      id,
      body.reason,
      before,
      invoice,
      r.patient_id,
      invoiceId,
    );
    return { invoice, receiptReference: receipt };
  }
  private async fillDraft(
    db: PoolClient,
    a: Access,
    invoiceId: string,
    patientId: string,
    priceListId: string,
    items: BillingLineInput[],
  ) {
    const list = (
      await db.query<{ currency: string }>(
        `SELECT p.currency FROM price_lists p JOIN billing_price_publications b ON b.clinic_id=p.clinic_id AND b.price_list_id=p.id WHERE p.clinic_id=$1 AND p.id=$2 FOR SHARE OF p,b`,
        [a.clinicId, priceListId],
      )
    ).rows[0];
    if (!list) throw missing();
    const totals: { gross: number; discount: number; tax: number; total: number }[] = [];
    for (const item of items) {
      const price = (
        await db.query<{ amount_minor: string; service_id: string; name: string }>(
          `SELECT p.amount_minor,p.service_id,s.name FROM price_list_items p JOIN services s ON s.clinic_id=p.clinic_id AND s.id=p.service_id AND s.active WHERE p.clinic_id=$1 AND p.price_list_id=$2 AND p.id=$3 FOR SHARE OF p,s`,
          [a.clinicId, priceListId, item.priceItemId],
        )
      ).rows[0];
      if (!price) throw missing();
      if (
        item.procedureId &&
        !(
          await db.query(
            `SELECT 1 FROM procedures p JOIN clinical_approvals a ON a.clinic_id=p.clinic_id AND a.revision_id=p.id AND a.decision='approved' WHERE p.clinic_id=$1 AND p.id=$2 AND p.patient_id=$3 AND p.status='completed' FOR SHARE OF p,a`,
            [a.clinicId, item.procedureId, patientId],
          )
        ).rowCount
      )
        throw missing();
      if (
        item.treatmentPlanItemId &&
        !(
          await db.query(
            `SELECT 1 FROM treatment_plan_items i JOIN treatment_plans p ON p.clinic_id=i.clinic_id AND p.id=i.treatment_plan_id JOIN clinical_approvals a ON a.clinic_id=p.clinic_id AND a.revision_id=p.id AND a.decision='approved' WHERE i.clinic_id=$1 AND i.id=$2 AND p.patient_id=$3 AND i.service_id=$4 FOR SHARE OF i,p,a`,
            [a.clinicId, item.treatmentPlanItemId, patientId, price.service_id],
          )
        ).rowCount
      )
        throw missing();
      const unit = minor(price.amount_minor);
      let total: number, gross: number;
      try {
        total = lineAmount(unit, item.quantityHundredths, item.discountMinor, item.taxMinor);
        gross = lineAmount(unit, item.quantityHundredths, 0, 0);
      } catch (error) {
        throw invalid(error instanceof Error ? error.message : 'Invalid money.');
      }
      const id = randomUUID(),
        q = BigInt(item.quantityHundredths),
        quantity = `${q / 100n}.${(q % 100n).toString().padStart(2, '0')}`;
      await db.query(
        `INSERT INTO invoice_items(id,clinic_id,invoice_id,service_id,procedure_id,description,quantity,unit_amount_minor,discount_minor,tax_minor,line_total_minor,currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          a.clinicId,
          invoiceId,
          price.service_id,
          item.procedureId,
          price.name,
          quantity,
          unit,
          item.discountMinor,
          item.taxMinor,
          total,
          list.currency,
        ],
      );
      if (item.treatmentPlanItemId)
        await db.query(
          'INSERT INTO billing_item_links(item_id,clinic_id,treatment_plan_item_id) VALUES($1,$2,$3)',
          [id, a.clinicId, item.treatmentPlanItemId],
        );
      totals.push({ gross, discount: item.discountMinor, tax: item.taxMinor, total });
    }
    try {
      const total = sumMinor(totals.map((i) => i.total));
      await db.query(
        'UPDATE invoices SET subtotal_minor=$3,discount_minor=$4,tax_minor=$5,total_minor=$6,balance_minor=$6,updated_at=clock_timestamp() WHERE clinic_id=$1 AND id=$2',
        [
          a.clinicId,
          invoiceId,
          sumMinor(totals.map((i) => i.gross)),
          sumMinor(totals.map((i) => i.discount)),
          sumMinor(totals.map((i) => i.tax)),
          total,
        ],
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'Money limit exceeded.')
        throw invalid(error.message);
      throw error;
    }
  }
  async create(c: AccessContext, body: z.infer<typeof InvoiceWriteSchema>) {
    return this.transaction(c, 'write', async (db, a) => {
      const hash = this.hash(a, 'draft_created', body.patientId, body),
        replay = await this.replay(db, a, body.requestKey, hash);
      if (replay) return replay;
      if (
        !(
          await db.query('SELECT 1 FROM patients WHERE clinic_id=$1 AND id=$2 FOR UPDATE', [
            a.clinicId,
            body.patientId,
          ])
        ).rowCount
      )
        throw missing();
      // Concurrent replays serialize on the patient; check again after acquiring the lock.
      const second = await this.replay(db, a, body.requestKey, hash);
      if (second) return second;
      const list = (
        await db.query<{ currency: string }>(
          'SELECT currency FROM price_lists WHERE clinic_id=$1 AND id=$2',
          [a.clinicId, body.priceListId],
        )
      ).rows[0];
      if (!list) throw missing();
      const id = randomUUID();
      await db.query(
        `INSERT INTO invoices(id,clinic_id,patient_id,invoice_number,currency,created_by_membership_id) VALUES($1,$2,$3,$4,$5,$6)`,
        [id, a.clinicId, body.patientId, `INV-${id}`, list.currency, a.membershipId],
      );
      await db.query('INSERT INTO billing_invoice_workflows(invoice_id,clinic_id) VALUES($1,$2)', [
        id,
        a.clinicId,
      ]);
      await this.fillDraft(db, a, id, body.patientId, body.priceListId, body.items);
      return this.record(db, c, a, id, 'draft_created', 0, body, hash, null);
    });
  }
  async mutate(
    c: AccessContext,
    id: string,
    kind:
      'draft_revised' | 'invoice_issued' | 'draft_discarded' | 'payment' | 'refund' | 'adjustment',
    body: Operation,
  ) {
    return this.transaction(
      c,
      ['refund', 'adjustment'].includes(kind) ? 'manage' : 'write',
      async (db, a) => {
        const r = await this.row(db, a, id),
          hash = this.hash(a, kind, id, body),
          replay = await this.replay(db, a, body.requestKey, hash);
        if (replay) return replay;
        if (r.discarded_at) throw conflict('Discarded drafts cannot be changed.');
        const before = await this.project(db, a, id);
        let amount = 0,
          paymentId: string | null = null,
          refundId: string | null = null;
        if (['draft_revised', 'invoice_issued', 'draft_discarded'].includes(kind)) {
          if (
            r.status !== 'draft' ||
            !('expectedVersion' in body) ||
            body.expectedVersion !== r.version
          )
            throw conflict();
          if (kind === 'draft_revised') {
            if (!('items' in body)) throw invalid('Draft content required.');
            const list = (
              await db.query<{ currency: string }>(
                'SELECT currency FROM price_lists WHERE clinic_id=$1 AND id=$2',
                [a.clinicId, body.priceListId],
              )
            ).rows[0];
            if (!list || list.currency !== r.currency)
              throw invalid('Draft currency cannot change. Create a new draft.');
            await db.query(
              'DELETE FROM billing_item_links WHERE clinic_id=$1 AND item_id IN (SELECT id FROM invoice_items WHERE clinic_id=$1 AND invoice_id=$2)',
              [a.clinicId, id],
            );
            await db.query('DELETE FROM invoice_items WHERE clinic_id=$1 AND invoice_id=$2', [
              a.clinicId,
              id,
            ]);
            await this.fillDraft(db, a, id, r.patient_id, body.priceListId, body.items);
          } else if (kind === 'invoice_issued') {
            amount = minor(r.total_minor);
            if (amount <= 0) throw invalid('Issued invoices must have a positive total.');
            await db.query(
              "UPDATE invoices SET status='issued',issued_at=clock_timestamp(),updated_at=clock_timestamp() WHERE clinic_id=$1 AND id=$2",
              [a.clinicId, id],
            );
          }
          await db.query(
            `UPDATE billing_invoice_workflows SET version=version+1,discarded_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END WHERE clinic_id=$1 AND invoice_id=$2`,
            [a.clinicId, id, kind === 'draft_discarded'],
          );
        } else {
          if (r.status === 'draft' || !('amountMinor' in body) || body.currency !== r.currency)
            throw invalid('A matching-currency issued invoice is required.');
          if (kind === 'payment') {
            if (!('method' in body)) throw invalid('Payment method required.');
            if (body.amountMinor > before.balanceMinor)
              throw conflict('Overpayments are not permitted.');
            paymentId = randomUUID();
            amount = -body.amountMinor;
            await db.query(
              `INSERT INTO payments(id,clinic_id,patient_id,invoice_id,status,method,amount_minor,currency,external_reference,received_at,recorded_by_membership_id) VALUES($1,$2,$3,$4,'succeeded',$5,$6,$7,$8,clock_timestamp(),$9)`,
              [
                paymentId,
                a.clinicId,
                r.patient_id,
                id,
                body.method,
                body.amountMinor,
                r.currency,
                body.externalReference,
                a.membershipId,
              ],
            );
          } else if (kind === 'refund') {
            if (!('paymentId' in body)) throw invalid('Original payment required.');
            const p = (
              await db.query<{ amount_minor: string }>(
                `SELECT p.amount_minor FROM payments p JOIN billing_ledger l ON l.clinic_id=p.clinic_id AND l.payment_id=p.id AND l.kind='payment' WHERE p.clinic_id=$1 AND p.id=$2 AND p.invoice_id=$3 FOR UPDATE OF p`,
                [a.clinicId, body.paymentId, id],
              )
            ).rows[0];
            if (!p) throw missing();
            const refunded = (
              await db.query<{ amount: string }>(
                "SELECT COALESCE(sum(amount_minor),0)::text AS amount FROM billing_ledger WHERE clinic_id=$1 AND payment_id=$2 AND kind='refund'",
                [a.clinicId, body.paymentId],
              )
            ).rows[0]!;
            if (body.amountMinor > minor(p.amount_minor) - minor(refunded.amount))
              throw conflict('Refund exceeds the original unrefunded payment.');
            paymentId = body.paymentId;
            refundId = randomUUID();
            amount = body.amountMinor;
            await db.query(
              `INSERT INTO refunds(id,clinic_id,payment_id,status,amount_minor,currency,reason,external_reference,refunded_at,recorded_by_membership_id) VALUES($1,$2,$3,'succeeded',$4,$5,$6,$7,clock_timestamp(),$8)`,
              [
                refundId,
                a.clinicId,
                paymentId,
                amount,
                r.currency,
                body.reason,
                body.externalReference,
                a.membershipId,
              ],
            );
          } else {
            amount = body.amountMinor;
            const balance = BigInt(before.balanceMinor) + BigInt(amount);
            const total = BigInt(before.adjustedTotalMinor) + BigInt(amount);
            if (balance > 1000000000000n || total > 1000000000000n)
              throw conflict('Adjustment exceeds the supported invoice limit.');
            if (balance < 0n || total < 0n)
              throw conflict('Credit exceeds the open balance. Refund funds first.');
          }
          await db.query(
            'UPDATE billing_invoice_workflows SET version=version+1 WHERE clinic_id=$1 AND invoice_id=$2',
            [a.clinicId, id],
          );
        }
        return this.record(db, c, a, id, kind, amount, body, hash, before, paymentId, refundId);
      },
    );
  }
  async reports(c: AccessContext) {
    return this.transaction(c, 'read', async (db, a) => {
      const rows = await db.query<{
        currency: string;
        invoice_count: string;
        issued: string;
        adjustment: string;
        payments: string;
        refunds: string;
        balance: string;
      }>(
        `SELECT i.currency,count(DISTINCT i.id)::text AS invoice_count,
        COALESCE(sum(l.amount_minor) FILTER(WHERE l.kind='invoice_issued'),0)::text AS issued,
        COALESCE(sum(l.amount_minor) FILTER(WHERE l.kind='adjustment'),0)::text AS adjustment,
        COALESCE(-sum(l.amount_minor) FILTER(WHERE l.kind='payment'),0)::text AS payments,
        COALESCE(sum(l.amount_minor) FILTER(WHERE l.kind='refund'),0)::text AS refunds,
        COALESCE(sum(l.amount_minor),0)::text AS balance FROM invoices i JOIN billing_invoice_workflows w ON w.clinic_id=i.clinic_id AND w.invoice_id=i.id JOIN billing_ledger l ON l.clinic_id=i.clinic_id AND l.invoice_id=i.id WHERE i.clinic_id=$1 AND i.status<>'draft' GROUP BY i.currency ORDER BY i.currency`,
        [a.clinicId],
      );
      return rows.rows.map((r) => ({
        currency: r.currency,
        invoiceCount: Number(r.invoice_count),
        issuedMinor: aggregate(BigInt(r.issued)),
        adjustmentMinor: aggregate(BigInt(r.adjustment)),
        adjustedTotalMinor: aggregate(BigInt(r.issued) + BigInt(r.adjustment)),
        paymentsMinor: aggregate(BigInt(r.payments)),
        refundsMinor: aggregate(BigInt(r.refunds)),
        balanceMinor: aggregate(BigInt(r.balance)),
      }));
    });
  }
}
