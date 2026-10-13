import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  BillingInvoiceSchema,
  BillingEventSchema,
  type BillingInvoice,
  type BillingLineInput,
} from '@dentalai/contracts';
import { lineAmount, sumMinor, parseMoney } from '@dentalai/domain';
import type { AccessContext } from '../access/access.repository.js';
import {
  Access,
  EventRow,
  missing,
  conflict,
  invalid,
  minor,
  aggregate,
} from './billing-shared.js';
import { BillingCore } from './billing-core.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class BillingProjectionRepository extends BillingCore {
  protected async project(
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
  protected async replay(db: PoolClient, a: Access, key: string, hash: string) {
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
  protected async record(
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
  protected async fillDraft(
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
}
