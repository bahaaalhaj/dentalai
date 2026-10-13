import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  ClinicalContentSchema,
  ClinicalRecordSchema,
  type ClinicalContent,
  type ClinicalRecord,
} from '@dentalai/contracts';
import { Access, Header, missing, tables } from './clinical-shared.js';
import { ClinicalCore } from './clinical-core.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class ClinicalContentRepository extends ClinicalCore {
  protected async content(db: PoolClient, clinicId: string, h: Header): Promise<ClinicalContent> {
    const result = await db.query<Record<string, unknown>>(
      `SELECT *${h.kind === 'demographics' ? ',date_of_birth::text AS date_of_birth' : ''} FROM ${tables[h.kind]} WHERE clinic_id=$1 AND id=$2`,
      [clinicId, h.id],
    );
    const r = result.rows[0];
    if (!r) throw missing();
    let content: unknown;
    if (h.kind === 'demographics')
      content = {
        kind: h.kind,
        givenName: r['given_name'],
        familyName: r['family_name'],
        preferredName: r['preferred_name'],
        dateOfBirth: r['date_of_birth'],
        phone: r['phone'],
        email: r['email'],
      };
    else if (h.kind === 'note')
      content = { kind: h.kind, noteType: r['note_type'], body: r['body'] };
    else if (h.kind === 'alert')
      content = {
        kind: h.kind,
        title: r['title'],
        details: r['details'],
        severity: r['severity'],
        active: r['active'],
      };
    else if (h.kind === 'allergy')
      content = {
        kind: h.kind,
        substance: r['substance'],
        reaction: r['reaction'],
        severity: r['severity'],
        status: r['status'],
      };
    else if (h.kind === 'medication')
      content = {
        kind: h.kind,
        medicationName: r['medication_name'],
        dose: r['dose'],
        route: r['route'],
        frequency: r['frequency'],
        status: r['status'],
      };
    else if (h.kind === 'finding' || h.kind === 'procedure') {
      const surfaceTable =
        h.kind === 'finding' ? 'odontogram_finding_surfaces' : 'procedure_surfaces';
      const column = h.kind === 'finding' ? 'finding_id' : 'procedure_id';
      const surfaces = (
        await db.query<{ surface_code: string }>(
          `SELECT surface_code FROM ${surfaceTable} WHERE clinic_id=$1 AND ${column}=$2 ORDER BY surface_code`,
          [clinicId, h.id],
        )
      ).rows.map((row) => row.surface_code);
      content =
        h.kind === 'finding'
          ? {
              kind: h.kind,
              toothCode: r['tooth_code'],
              surfaces,
              findingCode: r['finding_code'],
              status: r['status'],
              details: r['details'],
            }
          : {
              kind: h.kind,
              toothCode: r['tooth_code'],
              surfaces,
              procedureCode: r['procedure_code'],
              status: r['status'],
              description: r['description'],
            };
    } else {
      const items = (
        await db.query<Record<string, unknown>>(
          `SELECT i.*,COALESCE((SELECT json_agg(s.surface_code ORDER BY s.surface_code) FROM treatment_plan_item_surfaces s WHERE s.clinic_id=i.clinic_id AND s.item_id=i.id),'[]') AS surfaces FROM treatment_plan_items i WHERE clinic_id=$1 AND treatment_plan_id=$2 ORDER BY sequence`,
          [clinicId, h.id],
        )
      ).rows;
      content = {
        kind: 'plan',
        name: r['name'],
        status: r['status'],
        items: items.map((i) => ({
          serviceId: i['service_id'],
          toothCode: i['tooth_code'],
          surfaces: i['surfaces'],
          description: i['description'],
          quantity: Number(i['quantity']),
          estimatedAmountMinor: i['estimated_amount_minor'],
          currency: i['currency'],
          status: i['status'],
        })),
      };
    }
    return ClinicalContentSchema.parse(content);
  }
  protected async headers(
    db: PoolClient,
    clinicId: string,
    patientId: string,
    cutoff?: string,
  ): Promise<Header[]> {
    return (
      await db.query<Header>(
        `SELECT r.*,u.display_name AS author_name,a.decision,a.reviewed_at,a.reason AS review_reason
      FROM clinical_revisions r JOIN memberships m ON m.id=r.author_membership_id AND m.clinic_id=r.clinic_id JOIN users u ON u.id=m.user_id
      LEFT JOIN clinical_approvals a ON a.clinic_id=r.clinic_id AND a.revision_id=r.id AND ($3::timestamptz IS NULL OR a.reviewed_at<=$3)
      WHERE r.clinic_id=$1 AND r.patient_id=$2 AND ($3::timestamptz IS NULL OR r.recorded_at<=$3) ORDER BY r.recorded_at,r.id`,
        [clinicId, patientId, cutoff ?? null],
      )
    ).rows;
  }
  protected async record(db: PoolClient, clinicId: string, h: Header): Promise<ClinicalRecord> {
    return ClinicalRecordSchema.parse({
      id: h.id,
      groupId: h.group_id,
      version: h.version,
      encounterId: h.encounter_id,
      authorName: h.author_name,
      recordedAt: h.recorded_at.toISOString(),
      reason: h.reason,
      approval: h.decision ?? 'pending',
      approvedAt: h.reviewed_at?.toISOString() ?? null,
      reviewReason: h.review_reason,
      data: await this.content(db, clinicId, h),
    });
  }
  protected async insertContent(
    db: PoolClient,
    a: Access,
    patientId: string,
    encounterId: string,
    id: string,
    group: string,
    version: number,
    prior: string | null,
    d: ClinicalContent,
    timestamp: string,
  ) {
    const common = [id, a.clinicId, patientId];
    if (d.kind === 'demographics')
      await db.query(
        'INSERT INTO clinical_demographics(id,clinic_id,given_name,family_name,preferred_name,date_of_birth,phone,email) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          a.clinicId,
          d.givenName,
          d.familyName,
          d.preferredName,
          d.dateOfBirth,
          d.phone,
          d.email,
        ],
      );
    else if (d.kind === 'note')
      await db.query(
        `INSERT INTO clinical_notes(id,clinic_id,patient_id,encounter_id,note_group_id,version,supersedes_note_id,status,note_type,body,authored_by_membership_id,is_current)
      VALUES($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,false)`,
        [...common, encounterId, group, version, prior, d.noteType, d.body, a.membershipId],
      );
    else if (d.kind === 'alert')
      await db.query(
        'INSERT INTO medical_alerts(id,clinic_id,patient_id,title,details,severity,active,recorded_by_membership_id,resolved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $7 THEN NULL ELSE $9::timestamptz END)',
        [...common, d.title, d.details, d.severity, d.active, a.membershipId, timestamp],
      );
    else if (d.kind === 'allergy')
      await db.query(
        'INSERT INTO allergies(id,clinic_id,patient_id,substance,reaction,severity,status,recorded_by_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [...common, d.substance, d.reaction, d.severity, d.status, a.membershipId],
      );
    else if (d.kind === 'medication')
      await db.query(
        'INSERT INTO medications(id,clinic_id,patient_id,medication_name,dose,route,frequency,status,recorded_by_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [...common, d.medicationName, d.dose, d.route, d.frequency, d.status, a.membershipId],
      );
    else if (d.kind === 'finding' || d.kind === 'procedure') {
      const dentition = d.toothCode
        ? Number(d.toothCode[0]) <= 4
          ? 'permanent'
          : 'primary'
        : null;
      if (d.kind === 'finding')
        await db.query(
          "INSERT INTO odontogram_findings(id,clinic_id,patient_id,encounter_id,tooth_code,dentition,finding_code,status,details,recorded_by_membership_id,resolved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::finding_status,$9,$10,CASE WHEN $8::finding_status='resolved' THEN $11::timestamptz ELSE NULL END)",
          [
            ...common,
            encounterId,
            d.toothCode,
            dentition,
            d.findingCode,
            d.status,
            d.details,
            a.membershipId,
            timestamp,
          ],
        );
      else
        await db.query(
          "INSERT INTO procedures(id,clinic_id,patient_id,encounter_id,provider_id,tooth_code,dentition,procedure_code,description,status,performed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::procedure_status,CASE WHEN $10::procedure_status='completed' THEN COALESCE((SELECT performed_at FROM procedures WHERE clinic_id=$2 AND id=$11),$12::timestamptz) ELSE NULL END)",
          [
            ...common,
            encounterId,
            a.providerId,
            d.toothCode,
            dentition,
            d.procedureCode,
            d.description,
            d.status,
            prior,
            timestamp,
          ],
        );
      const table = d.kind === 'finding' ? 'odontogram_finding_surfaces' : 'procedure_surfaces',
        column = d.kind === 'finding' ? 'finding_id' : 'procedure_id';
      for (const s of d.surfaces)
        await db.query(`INSERT INTO ${table}(clinic_id,${column},surface_code) VALUES($1,$2,$3)`, [
          a.clinicId,
          id,
          s,
        ]);
      if (d.kind === 'procedure')
        await db.query(
          "INSERT INTO procedure_status_history(clinic_id,procedure_id,from_status,to_status,changed_by_membership_id,reason,occurred_at) VALUES($1,$2,NULL,$3,$4,'Version recorded; see clinical revision reason',$5::timestamptz)",
          [a.clinicId, id, d.status, a.membershipId, timestamp],
        );
    } else {
      for (const item of d.items) {
        if (
          !(
            await db.query(
              'SELECT 1 FROM services WHERE clinic_id=$1 AND id=$2 AND active FOR SHARE',
              [a.clinicId, item.serviceId],
            )
          ).rowCount
        )
          throw missing();
      }
      await db.query(
        'INSERT INTO treatment_plans(id,clinic_id,patient_id,provider_id,name,version,status,supersedes_plan_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [...common, a.providerId, d.name, version, d.status, prior],
      );
      for (const [index, item] of d.items.entries()) {
        const itemId = randomUUID();
        await db.query(
          'INSERT INTO treatment_plan_items(id,clinic_id,treatment_plan_id,service_id,sequence,tooth_code,description,quantity,estimated_amount_minor,currency,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            itemId,
            a.clinicId,
            id,
            item.serviceId,
            index + 1,
            item.toothCode,
            item.description,
            item.quantity,
            item.estimatedAmountMinor,
            item.currency,
            item.status,
          ],
        );
        for (const s of item.surfaces)
          await db.query(
            'INSERT INTO treatment_plan_item_surfaces(clinic_id,item_id,surface_code) VALUES($1,$2,$3)',
            [a.clinicId, itemId, s],
          );
      }
    }
  }
}
