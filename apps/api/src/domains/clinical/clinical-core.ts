import type { Pool, PoolClient } from 'pg';
import { PatientSummarySchema } from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError, DependencyUnavailableError } from '../../errors/domain-errors.js';
import { Access, denied, missing, conflict } from './clinical-shared.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class ClinicalCore {
  constructor(readonly pool: Pool) {}
  protected async transaction<T>(
    context: AccessContext,
    clinician: boolean,
    operation: (db: PoolClient, access: Access) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect().catch(() => {
      throw new DependencyUnavailableError();
    });
    try {
      await db.query('BEGIN');
      const m = context.membership;
      if (!m) throw denied();
      await db.query('SELECT saas_lock($1)', [m.clinicId]);
      const rows = await db.query<{ key: string }>(
        `SELECT r.key FROM memberships m
        JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL JOIN clinics c ON c.id=m.clinic_id AND c.active
        JOIN auth_sessions s ON s.user_id=u.id AND s.id=$3 AND s.expires_at>now()
        JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id
        JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id
        WHERE m.id=$1 AND m.user_id=$2 AND m.clinic_id=$4 AND m.status='active'
        AND (s.active_membership_id IS NULL OR s.active_membership_id=m.id) FOR SHARE OF m,u,c,s,mr,r`,
        [m.id, context.userId, context.sessionId, m.clinicId],
      );
      const dentist = rows.rows.some((row) => row.key === 'dentist');
      const patientRole = rows.rows.some((row) => row.key === 'patient');
      const providers = dentist
        ? await db.query<{ id: string }>(
            `SELECT p.id FROM providers p JOIN staff s ON s.clinic_id=p.clinic_id AND s.id=p.staff_id
        WHERE p.clinic_id=$1 AND s.membership_id=$2 AND p.active AND s.active FOR SHARE OF p,s`,
            [m.clinicId, m.id],
          )
        : undefined;
      const providerId = providers?.rows[0]?.id ?? null;
      if (!rows.rowCount || (clinician ? !providerId : !patientRole)) throw denied();
      const result = await operation(db, {
        clinicId: m.clinicId,
        membershipId: m.id,
        providerId,
        patientRole,
      });
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['23505', '40001', '40P01'].includes(String(error.code))
      )
        throw conflict();
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        /^(08|53|57|P0001)/.test(String(error.code))
      )
        throw new DependencyUnavailableError();
      throw error;
    } finally {
      db.release();
    }
  }
  protected async patient(db: PoolClient, access: Access, id: string) {
    const result = await db.query(
      `SELECT id,given_name AS "givenName",family_name AS "familyName",medical_record_number AS "medicalRecordNumber"
      FROM patients WHERE clinic_id=$1 AND id=$2 FOR UPDATE`,
      [access.clinicId, id],
    );
    if (!result.rows[0]) throw missing();
    return PatientSummarySchema.parse(result.rows[0]);
  }
  protected async openEncounter(
    db: PoolClient,
    access: Access,
    encounterId: string,
    patientId: string,
  ): Promise<void> {
    const result = await db.query<{ status: string }>(
      'SELECT status FROM encounters WHERE clinic_id=$1 AND id=$2 AND patient_id=$3 FOR UPDATE',
      [access.clinicId, encounterId, patientId],
    );
    if (!result.rows[0]) throw missing();
    if (result.rows[0].status !== 'open') throw conflict();
  }
  protected async audit(
    db: PoolClient,
    context: AccessContext,
    access: Access,
    patientId: string,
    action: string,
    id: string,
    reason: string,
    before: unknown,
    after: unknown,
    timestamp: string,
  ): Promise<void> {
    await db.query(
      `INSERT INTO audit_events(clinic_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,request_id,data,occurred_at)
      VALUES($1,$2,$3,$4,'clinical',$5,$6,$7::jsonb,$8::timestamptz)`,
      [
        access.clinicId,
        context.userId,
        access.membershipId,
        action,
        id,
        context.requestId,
        JSON.stringify({ patientId, reason, before, after }),
        timestamp,
      ],
    );
  }
  protected async eventTime(db: PoolClient, a: Access, patientId: string): Promise<string> {
    // The patient row is locked before this call. Retain PostgreSQL microseconds and
    // reject clock regressions rather than inventing clinical times or corrupting as-of views.
    const result = await db.query<{ event_time: string; ordered: boolean }>(
      `WITH observed AS MATERIALIZED (SELECT clock_timestamp() AS value), previous AS (
        SELECT max(value) AS value FROM (
          SELECT started_at AS value FROM encounters WHERE clinic_id=$1 AND patient_id=$2
          UNION ALL SELECT signed_at FROM encounters WHERE clinic_id=$1 AND patient_id=$2
          UNION ALL SELECT recorded_at FROM clinical_revisions WHERE clinic_id=$1 AND patient_id=$2
          UNION ALL SELECT a.reviewed_at FROM clinical_approvals a JOIN clinical_revisions r
            ON r.clinic_id=a.clinic_id AND r.id=a.revision_id WHERE r.clinic_id=$1 AND r.patient_id=$2
        ) events
      ) SELECT observed.value::text AS event_time,
        previous.value IS NULL OR observed.value>previous.value AS ordered FROM observed,previous`,
      [a.clinicId, patientId],
    );
    if (!result.rows[0]!.ordered)
      throw new DomainError(
        'CLINICAL_CLOCK_CONFLICT',
        'The server clock precedes recorded clinical history. No change was saved. Retry after the server clock is corrected.',
        409,
      );
    return result.rows[0]!.event_time;
  }
}
