import type { PoolClient } from 'pg';
import { PatientSummarySchema, type ClinicalRecord } from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';
import { Access, Header, missing, tables } from './clinical-shared.js';
import { ClinicalContentRepository } from './clinical-content.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class ClinicalHistoryRepository extends ClinicalContentRepository {
  async directory(context: AccessContext) {
    return this.transaction(context, true, async (db, a) =>
      (
        await db.query(
          `SELECT id,given_name AS "givenName",family_name AS "familyName",medical_record_number AS "medicalRecordNumber"
      FROM patients WHERE clinic_id=$1 ORDER BY family_name,given_name,id LIMIT 500`,
          [a.clinicId],
        )
      ).rows.map((row) => PatientSummarySchema.parse(row)),
    );
  }
  protected async retainedLegacy(db: PoolClient, clinicId: string, patientId: string) {
    const records: Array<{
      id: string;
      kind: string;
      fields: Array<{ name: string; value: string | null }>;
    }> = [];
    for (const [kind, table] of Object.entries(tables)) {
      if (kind === 'demographics') continue;
      // Read-only projection of NORMALIZED retained SQL rows, not a second clinical truth store.
      const rows = await db.query<{ id: string; fields: Record<string, unknown> }>(
        `SELECT t.id,to_jsonb(t) AS fields FROM ${table} t WHERE t.clinic_id=$1 AND t.patient_id=$2 AND NOT EXISTS(SELECT 1 FROM clinical_revisions r WHERE r.clinic_id=t.clinic_id AND r.id=t.id) ORDER BY t.id`,
        [clinicId, patientId],
      );
      for (const row of rows.rows) {
        if (kind === 'finding')
          row.fields['surfaces'] = (
            await db.query(
              'SELECT surface_code FROM odontogram_finding_surfaces WHERE clinic_id=$1 AND finding_id=$2',
              [clinicId, row.id],
            )
          ).rows;
        if (kind === 'procedure') {
          row.fields['surfaces'] = (
            await db.query(
              'SELECT surface_code FROM procedure_surfaces WHERE clinic_id=$1 AND procedure_id=$2',
              [clinicId, row.id],
            )
          ).rows;
          row.fields['status_history'] = (
            await db.query(
              'SELECT from_status,to_status,reason,occurred_at,changed_by_membership_id FROM procedure_status_history WHERE clinic_id=$1 AND procedure_id=$2 ORDER BY occurred_at,id',
              [clinicId, row.id],
            )
          ).rows;
        }
        if (kind === 'plan')
          row.fields['items'] = (
            await db.query(
              'SELECT * FROM treatment_plan_items WHERE clinic_id=$1 AND treatment_plan_id=$2 ORDER BY sequence',
              [clinicId, row.id],
            )
          ).rows;
        records.push({
          id: row.id,
          kind,
          fields: Object.entries(row.fields)
            .filter(([name]) => !['id', 'clinic_id', 'patient_id'].includes(name))
            .map(([name, value]) => ({
              name,
              value:
                value === null ? null : typeof value === 'string' ? value : JSON.stringify(value),
            })),
        });
      }
    }
    return records;
  }
  protected async cutoff(
    db: PoolClient,
    a: Access,
    patientId: string,
    encounterId?: string,
  ): Promise<string | undefined> {
    if (!encounterId) return undefined;
    const result = await db.query<{ status: string; signed_at: string | null }>(
      'SELECT status,signed_at::text AS signed_at FROM encounters WHERE clinic_id=$1 AND patient_id=$2 AND id=$3',
      [a.clinicId, patientId, encounterId],
    );
    if (!result.rows[0]) throw missing();
    if (result.rows[0].status === 'open' || !result.rows[0].signed_at)
      throw new DomainError(
        'ENCOUNTER_NOT_CLOSED',
        'Historical reconstruction requires a closed encounter.',
        409,
      );
    return result.rows[0].signed_at;
  }
  async workspace(context: AccessContext, patientId: string, encounterId?: string) {
    return this.transaction(context, true, async (db, a) => {
      const patient = await this.patient(db, a, patientId);
      const cutoff = await this.cutoff(db, a, patientId, encounterId);
      const history: ClinicalRecord[] = [];
      for (const h of await this.headers(db, a.clinicId, patientId, cutoff))
        history.push(await this.record(db, a.clinicId, h));
      const latest = new Map<string, ClinicalRecord>();
      for (const r of history) {
        if (!latest.has(r.groupId) || latest.get(r.groupId)!.version < r.version)
          latest.set(r.groupId, r);
      }
      const encounters = (
        await db.query<{
          id: string;
          status: string;
          started_at: Date;
          ended_at: Date | null;
          author_name: string;
        }>(
          `SELECT e.*,u.display_name AS author_name FROM encounters e
        JOIN providers p ON p.clinic_id=e.clinic_id AND p.id=e.provider_id JOIN staff s ON s.clinic_id=p.clinic_id AND s.id=p.staff_id
        JOIN memberships m ON m.clinic_id=s.clinic_id AND m.id=s.membership_id JOIN users u ON u.id=m.user_id
        WHERE e.clinic_id=$1 AND e.patient_id=$2 ORDER BY e.started_at DESC,e.id`,
          [a.clinicId, patientId],
        )
      ).rows.map((e) => ({
        id: e.id,
        status: e.status,
        startedAt: e.started_at.toISOString(),
        endedAt: e.ended_at?.toISOString() ?? null,
        authorName: e.author_name,
      }));
      const services = (
        await db.query('SELECT id,name FROM services WHERE clinic_id=$1 AND active ORDER BY name', [
          a.clinicId,
        ])
      ).rows;
      return {
        patient,
        encounters,
        records: [...latest.values()],
        history,
        legacyRecords: await this.retainedLegacy(db, a.clinicId, patientId),
        services,
      };
    });
  }
  async portal(context: AccessContext, encounterId?: string) {
    return this.transaction(context, false, async (db, a) => {
      const linked = await db.query<{ id: string }>(
        'SELECT id FROM patients WHERE clinic_id=$1 AND portal_user_id=$2 FOR UPDATE',
        [a.clinicId, context.userId],
      );
      const patientId = linked.rows[0]?.id;
      if (!patientId) return { records: [], history: [] };
      const cutoff = await this.cutoff(db, a, patientId, encounterId);
      const latest = new Map<string, Header>();
      const approved: Header[] = [];
      for (const h of await this.headers(db, a.clinicId, patientId, cutoff)) {
        if (h.decision !== 'approved' || !h.reviewed_at) continue;
        approved.push(h);
        if (!latest.has(h.group_id) || latest.get(h.group_id)!.version < h.version)
          latest.set(h.group_id, h);
      }
      const project = async (h: Header) => ({
        id: h.id,
        encounterId: h.encounter_id,
        recordedAt: h.recorded_at.toISOString(),
        approvedAt: h.reviewed_at!.toISOString(),
        version: h.version,
        superseded: latest.get(h.group_id)?.id !== h.id,
        data: await this.content(db, a.clinicId, h),
      });
      const records = [];
      for (const h of latest.values()) {
        const r = await project(h);
        if (!('status' in r.data && r.data.status === 'entered_in_error')) records.push(r);
      }
      const history = [];
      for (const h of approved) history.push(await project(h));
      return { records, history };
    });
  }
}
