import type { Pool, PoolClient } from 'pg';
import { assessAnesthesia } from '@dentalai/domain';
import {
  AnesthesiaAssessmentSchema,
  AnesthesiaHistorySchema,
  type AnesthesiaWriteSchema,
} from '@dentalai/contracts';
import type { z } from 'zod';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';

export class AnesthesiaRepository {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(
    context: AccessContext,
    patient: string | undefined,
    operation: (db: PoolClient, clinic: string, provider: string) => Promise<T>,
  ): Promise<T> {
    const m = context.membership;
    if (!m) throw new DomainError('ACCESS_DENIED', 'Select a clinic first.', 403);
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT saas_lock($1)', [m.clinicId]);
      const result = await db.query<{ id: string }>(
        `SELECT p.id FROM memberships m
        JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
        JOIN clinics c ON c.id=m.clinic_id AND c.active
        JOIN auth_sessions se ON se.id=$3 AND se.user_id=u.id AND se.expires_at>now()
        JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id
        JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id AND r.key='dentist'
        JOIN staff s ON s.clinic_id=m.clinic_id AND s.membership_id=m.id AND s.active
        JOIN providers p ON p.clinic_id=s.clinic_id AND p.staff_id=s.id AND p.active
        WHERE m.id=$1 AND m.clinic_id=$2 AND m.user_id=$4 AND m.status='active'
        AND (se.active_membership_id IS NULL OR se.active_membership_id=m.id)
        FOR SHARE OF m,u,c,se,mr,r,s,p`,
        [m.id, m.clinicId, context.sessionId, context.userId],
      );
      const provider = result.rows[0]?.id;
      if (!provider)
        throw new DomainError('ACCESS_DENIED', 'An active clinic dentist is required.', 403);
      if (
        patient &&
        !(
          await db.query('SELECT id FROM patients WHERE clinic_id=$1 AND id=$2 FOR SHARE', [
            m.clinicId,
            patient,
          ])
        ).rowCount
      )
        throw new DomainError('ASSESSMENT_NOT_FOUND', 'Assessment or patient not found.', 404);
      const value = await operation(db, m.clinicId, provider);
      await db.query('COMMIT');
      return value;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  async history(context: AccessContext, patient: string) {
    return this.tx(context, patient, async (db, clinic) => {
      const records = await db.query(
        `SELECT id,version,inputs->'input' AS input,
        inputs->'provenance' AS provenance,modeled_output AS output,
        approval_state AS "approvalState",created_at::text AS "createdAt"
        FROM anesthesia_assessments WHERE clinic_id=$1 AND patient_id=$2
        AND rule_set_version='anesthesia-structure-v1' ORDER BY version`,
        [clinic, patient],
      );
      return AnesthesiaHistorySchema.parse(records.rows);
    });
  }
  async create(
    context: AccessContext,
    patient: string,
    body: z.infer<typeof AnesthesiaWriteSchema>,
  ) {
    return this.tx(context, patient, async (db, clinic, provider) => {
      // Serializes history numbering without modifying the patient or any prior assessment.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${clinic}:${patient}:anesthesia`,
      ]);
      const previous = await db.query<{ id: string; version: number }>(
        `SELECT id,version
        FROM anesthesia_assessments WHERE clinic_id=$1 AND patient_id=$2
        AND rule_set_version='anesthesia-structure-v1' ORDER BY version DESC LIMIT 1`,
        [clinic, patient],
      );
      const prior = previous.rows[0];
      const output = assessAnesthesia(body.input);
      const provenance = {
        source: body.source,
        observedAt: body.observedAt,
        authorUserId: context.userId,
        providerId: provider,
        reason: body.reason,
        requestId: context.requestId,
      };
      const created = await db.query<{ id: string; createdAt: string }>(
        `INSERT INTO anesthesia_assessments
        (clinic_id,patient_id,provider_id,version,supersedes_assessment_id,rule_set_version,inputs,modeled_output)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,created_at::text AS "createdAt"`,
        [
          clinic,
          patient,
          provider,
          (prior?.version ?? 0) + 1,
          prior?.id ?? null,
          output.ruleSetVersion,
          JSON.stringify({ input: body.input, provenance }),
          JSON.stringify(output),
        ],
      );
      const row = created.rows[0];
      if (!row) throw new Error('Assessment insertion returned no row.');
      await db.query(
        `INSERT INTO audit_events(clinic_id,actor_user_id,action,entity_type,entity_id,request_id,data)
        VALUES($1,$2,'anesthesia.assessed','anesthesia_assessment',$3,$4,$5)`,
        [
          clinic,
          context.userId,
          row.id,
          context.requestId,
          JSON.stringify({
            patientId: patient,
            reason: body.reason,
            beforeAssessmentId: prior?.id ?? null,
            after: { input: body.input, provenance, output },
          }),
        ],
      );
      return AnesthesiaAssessmentSchema.parse({
        ...row,
        version: (prior?.version ?? 0) + 1,
        input: body.input,
        provenance,
        output,
        approvalState: 'draft',
      });
    });
  }
  async confirm(context: AccessContext, id: string) {
    return this.tx(context, undefined, async (db, clinic) => {
      const row = await db.query(
        `SELECT id FROM anesthesia_assessments WHERE clinic_id=$1 AND id=$2
        AND rule_set_version='anesthesia-structure-v1' FOR UPDATE`,
        [clinic, id],
      );
      if (!row.rowCount)
        throw new DomainError('ASSESSMENT_NOT_FOUND', 'Assessment not found.', 404);
      // A clinician cannot override missing clinical references by confirming a blocked output.
      throw new DomainError(
        'RECOMMENDATION_DISABLED',
        'Cannot confirm: clinical references, rules and golden cases have not been approved.',
        409,
      );
    });
  }
}
