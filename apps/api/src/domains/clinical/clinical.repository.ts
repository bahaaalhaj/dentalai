import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  ClinicalContentSchema,
  ClinicalRecordSchema,
  PatientSummarySchema,
  type ClinicalContent,
  type ClinicalRecord,
  type ClinicalWrite,
} from '@dentalai/contracts';
import type { AccessContext } from '../access/access.repository.js';
import { DomainError, DependencyUnavailableError } from '../../errors/domain-errors.js';
import { validateClinicalRevision } from './clinical.service.js';

type Access = {
  clinicId: string;
  membershipId: string;
  providerId: string | null;
  patientRole: boolean;
};
type Header = {
  id: string;
  patient_id: string;
  encounter_id: string;
  kind: ClinicalContent['kind'];
  group_id: string;
  version: number;
  author_name: string;
  reason: string;
  recorded_at: Date;
  decision: 'approved' | 'rejected' | null;
  reviewed_at: Date | null;
  review_reason: string | null;
};
const denied = () => new DomainError('ACCESS_DENIED', 'Clinical access denied.', 403);
const missing = () => new DomainError('NOT_FOUND', 'Clinical record or patient not found.', 404);
const conflict = () =>
  new DomainError(
    'CLINICAL_CONFLICT',
    'The record changed or this encounter is closed. Refresh before retrying.',
    409,
  );
const tables = {
  demographics: 'clinical_demographics',
  note: 'clinical_notes',
  alert: 'medical_alerts',
  allergy: 'allergies',
  medication: 'medications',
  finding: 'odontogram_findings',
  procedure: 'procedures',
  plan: 'treatment_plans',
} as const;

export class ClinicalRepository {
  constructor(readonly pool: Pool) {}
  private async transaction<T>(
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
  private async patient(db: PoolClient, access: Access, id: string) {
    const result = await db.query(
      `SELECT id,given_name AS "givenName",family_name AS "familyName",medical_record_number AS "medicalRecordNumber"
      FROM patients WHERE clinic_id=$1 AND id=$2 FOR UPDATE`,
      [access.clinicId, id],
    );
    if (!result.rows[0]) throw missing();
    return PatientSummarySchema.parse(result.rows[0]);
  }
  private async openEncounter(
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
  private async audit(
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
  private async eventTime(db: PoolClient, a: Access, patientId: string): Promise<string> {
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
  private async content(db: PoolClient, clinicId: string, h: Header): Promise<ClinicalContent> {
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
  private async headers(
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
  private async record(db: PoolClient, clinicId: string, h: Header): Promise<ClinicalRecord> {
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
  private async retainedLegacy(db: PoolClient, clinicId: string, patientId: string) {
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
  private async cutoff(
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
  private async insertContent(
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
