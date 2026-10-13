import { randomUUID } from 'node:crypto';
import { type ClinicalWrite } from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError } from '../../errors/domain-errors.js';
import { validateClinicalRevision } from './clinical.service.js';
import { Header, missing, conflict } from './clinical-shared.js';
import { ClinicalHistoryRepository } from './clinical-history.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class ClinicalRepository extends ClinicalHistoryRepository {
  async startEncounter(
    context: AccessContext,
    patientId: string,
    reason: string,
    appointmentId: string | null,
  ) {
    return this.transaction(context, true, async (db, a) => {
      await this.patient(db, a, patientId);
      if (appointmentId) {
        const appointment = await db.query(
          "SELECT id FROM appointments WHERE clinic_id=$1 AND patient_id=$2 AND id=$3 AND provider_id=$4 AND status IN ('confirmed','completed') FOR SHARE",
          [a.clinicId, patientId, appointmentId, a.providerId],
        );
        if (!appointment.rowCount) throw missing();
      }
      const timestamp = await this.eventTime(db, a, patientId);
      const result = await db.query<{ id: string; started_at: Date }>(
        `INSERT INTO encounters(clinic_id,patient_id,appointment_id,provider_id,started_at) VALUES($1,$2,$3,$4,$5::timestamptz) RETURNING id,started_at`,
        [a.clinicId, patientId, appointmentId, a.providerId, timestamp],
      );
      const row = result.rows[0]!;
      await db.query(
        'INSERT INTO clinical_encounter_provenance(encounter_id,clinic_id,author_membership_id,reason) VALUES($1,$2,$3,$4)',
        [row.id, a.clinicId, a.membershipId, reason],
      );
      const encounter = {
        id: row.id,
        status: 'open',
        startedAt: row.started_at.toISOString(),
        endedAt: null,
        authorName: (
          await db.query<{ name: string }>('SELECT display_name AS name FROM users WHERE id=$1', [
            context.userId,
          ])
        ).rows[0]!.name,
      };
      await this.audit(
        db,
        context,
        a,
        patientId,
        'clinical.encounter_created',
        row.id,
        reason,
        null,
        encounter,
        timestamp,
      );
      return encounter;
    });
  }
  async write(context: AccessContext, patientId: string, body: ClinicalWrite) {
    return this.transaction(context, true, async (db, a) => {
      await this.patient(db, a, patientId);
      await this.openEncounter(db, a, body.encounterId, patientId);
      let prior: Header | undefined;
      if (body.supersedesId) {
        prior = (await this.headers(db, a.clinicId, patientId)).find(
          (h) => h.id === body.supersedesId,
        );
        if (!prior) throw missing();
        if (
          (
            await db.query(
              'SELECT 1 FROM clinical_revisions WHERE clinic_id=$1 AND supersedes_id=$2',
              [a.clinicId, prior.id],
            )
          ).rowCount
        )
          throw conflict();
      }
      const before = prior ? await this.content(db, a.clinicId, prior) : undefined;
      validateClinicalRevision(body.data, before);
      const id = randomUUID(),
        group = prior?.group_id ?? id,
        version = (prior?.version ?? 0) + 1;
      const timestamp = await this.eventTime(db, a, patientId);
      await db.query(
        `INSERT INTO clinical_revisions(id,clinic_id,patient_id,encounter_id,kind,group_id,version,supersedes_id,author_membership_id,reason,recorded_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)`,
        [
          id,
          a.clinicId,
          patientId,
          body.encounterId,
          body.data.kind,
          group,
          version,
          prior?.id ?? null,
          a.membershipId,
          body.reason,
          timestamp,
        ],
      );
      await this.insertContent(
        db,
        a,
        patientId,
        body.encounterId,
        id,
        group,
        version,
        prior?.id ?? null,
        body.data,
        timestamp,
      );
      const h = (await this.headers(db, a.clinicId, patientId)).find((r) => r.id === id)!;
      const record = await this.record(db, a.clinicId, h);
      await this.audit(
        db,
        context,
        a,
        patientId,
        prior ? 'clinical.corrected' : 'clinical.created',
        id,
        body.reason,
        before ?? null,
        record,
        timestamp,
      );
      return record;
    });
  }
  async review(
    context: AccessContext,
    id: string,
    decision: 'approved' | 'rejected',
    reason: string,
  ) {
    return this.transaction(context, true, async (db, a) => {
      const lookup = await db.query<{ patient_id: string }>(
        'SELECT patient_id FROM clinical_revisions WHERE clinic_id=$1 AND id=$2',
        [a.clinicId, id],
      );
      const patientId = lookup.rows[0]?.patient_id;
      if (!patientId) throw missing();
      await this.patient(db, a, patientId);
      const h = (await this.headers(db, a.clinicId, patientId)).find((r) => r.id === id)!;
      await this.openEncounter(db, a, h.encounter_id, patientId);
      if (
        h.decision ||
        (
          await db.query(
            'SELECT 1 FROM clinical_revisions WHERE clinic_id=$1 AND supersedes_id=$2',
            [a.clinicId, id],
          )
        ).rowCount
      )
        throw conflict();
      const before = await this.record(db, a.clinicId, h);
      const timestamp = await this.eventTime(db, a, patientId);
      await db.query(
        'INSERT INTO clinical_approvals(clinic_id,revision_id,decision,reviewer_membership_id,reason,reviewed_at) VALUES($1,$2,$3,$4,$5,$6::timestamptz)',
        [a.clinicId, id, decision, a.membershipId, reason, timestamp],
      );
      const data = before.data;
      const demographicsBefore =
        data.kind === 'demographics'
          ? (
              await db.query(
                'SELECT given_name,family_name,preferred_name,date_of_birth::text AS date_of_birth,phone,email FROM patients WHERE clinic_id=$1 AND id=$2',
                [a.clinicId, patientId],
              )
            ).rows[0]
          : undefined;
      if (decision === 'approved' && data.kind === 'demographics')
        await db.query(
          'UPDATE patients SET given_name=$3,family_name=$4,preferred_name=$5,date_of_birth=$6,phone=$7,email=$8,updated_at=$9::timestamptz WHERE clinic_id=$1 AND id=$2',
          [
            a.clinicId,
            patientId,
            data.givenName,
            data.familyName,
            data.preferredName,
            data.dateOfBirth,
            data.phone,
            data.email,
            timestamp,
          ],
        );
      const after = await this.record(
        db,
        a.clinicId,
        (await this.headers(db, a.clinicId, patientId)).find((r) => r.id === id)!,
      );
      await this.audit(
        db,
        context,
        a,
        patientId,
        `clinical.${decision}`,
        id,
        reason,
        demographicsBefore ? { record: before, demographics: demographicsBefore } : before,
        after,
        timestamp,
      );
      return { success: true as const };
    });
  }
  async close(context: AccessContext, id: string, reason: string) {
    return this.transaction(context, true, async (db, a) => {
      const lookup = await db.query<{ patient_id: string }>(
        'SELECT patient_id FROM encounters WHERE clinic_id=$1 AND id=$2',
        [a.clinicId, id],
      );
      const patientId = lookup.rows[0]?.patient_id;
      if (!patientId) throw missing();
      await this.patient(db, a, patientId);
      await this.openEncounter(db, a, id, patientId);
      const pending = await db.query(
        `SELECT 1 FROM clinical_revisions r WHERE r.clinic_id=$1 AND r.encounter_id=$2
        AND NOT EXISTS(SELECT 1 FROM clinical_revisions n WHERE n.clinic_id=r.clinic_id AND n.supersedes_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM clinical_approvals a WHERE a.clinic_id=r.clinic_id AND a.revision_id=r.id)`,
        [a.clinicId, id],
      );
      if (pending.rowCount)
        throw new DomainError(
          'PENDING_CLINICAL_REVIEW',
          'Approve or reject pending entries before closing the encounter.',
          409,
        );
      const before = (
        await db.query('SELECT * FROM encounters WHERE clinic_id=$1 AND id=$2', [a.clinicId, id])
      ).rows[0];
      const timestamp = await this.eventTime(db, a, patientId);
      const after = (
        await db.query(
          `UPDATE encounters SET status='signed',ended_at=$4::timestamptz,signed_at=$4::timestamptz,signed_by_membership_id=$3 WHERE clinic_id=$1 AND id=$2 RETURNING *`,
          [a.clinicId, id, a.membershipId, timestamp],
        )
      ).rows[0];
      await this.audit(
        db,
        context,
        a,
        patientId,
        'clinical.encounter_closed',
        id,
        reason,
        before,
        after,
        timestamp,
      );
      return { success: true as const };
    });
  }
}
