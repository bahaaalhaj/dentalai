import { z } from 'zod';
import {
  BillingCatalogSchema,
  type PricingWriteSchema,
  type ServiceWriteSchema,
} from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import { missing, invalid, minor, aggregate } from './billing-shared.js';
import { BillingProjectionRepository } from './billing-projection.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class BillingCatalogRepository extends BillingProjectionRepository {
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
