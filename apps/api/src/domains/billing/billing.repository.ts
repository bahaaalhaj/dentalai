import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type InvoiceWriteSchema } from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import { Operation, missing, conflict, invalid, minor } from './billing-shared.js';
import { BillingCatalogRepository } from './billing-catalog.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class BillingRepository extends BillingCatalogRepository {
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
}
