import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ClinicalRecordSchema,
  ClinicalWorkspaceSchema,
  ClinicalPortalSchema,
  EncounterSchema,
  type ClinicalContent,
} from '@dentalai/contracts';
import { createSchedulingFixture, mutation } from '../support/scheduling-fixture.js';
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL must be disposable PostgreSQL.');
let f: Awaited<ReturnType<typeof createSchedulingFixture>>;
beforeAll(async () => {
  f = await createSchedulingFixture(url);
  const foreign = f.members['foreign']!;
  const staffId = randomUUID();
  for (const role of ['dentist', 'patient'])
    await f.database.pool.query(
      'INSERT INTO membership_roles(clinic_id,membership_id,role_id) SELECT $1,$2,id FROM roles WHERE clinic_id=$1 AND key=$3',
      [f.otherClinicId, foreign.membershipId, role],
    );
  await f.database.pool.query(
    "INSERT INTO staff(id,clinic_id,membership_id,kind) VALUES($1,$2,$3,'provider')",
    [staffId, f.otherClinicId, foreign.membershipId],
  );
  await f.database.pool.query(
    "INSERT INTO providers(clinic_id,staff_id,provider_type) VALUES($1,$2,'dentist')",
    [f.otherClinicId, staffId],
  );
});
afterAll(async () => {
  if (f) await f.dispose();
});
beforeEach(async () => {
  await f.database.pool.query('DELETE FROM auth_rate_limits');
});
const note: ClinicalContent = {
  kind: 'note',
  noteType: 'progress',
  body: 'Fictional private progress note',
};
const finding: ClinicalContent = {
  kind: 'finding',
  toothCode: '16',
  surfaces: ['O'],
  findingCode: 'caries',
  status: 'active',
  details: 'Fictional finding',
};
const mutate = (path: string, body: object, role = 'dentist') =>
  mutation(f.app, f.origin, path, body, f.members[role]!.cookie);
const get = (path: string, role = 'dentist') =>
  request(f.app).get(path).set('cookie', f.members[role]!.cookie);
async function encounter(patient = f.patientId) {
  const result = await mutate(`/api/v1/clinical/patients/${patient}/encounters`, {
    reason: 'Fictional encounter',
    appointmentId: null,
  });
  expect(result.status, result.text).toBe(200);
  return EncounterSchema.parse(result.body);
}
async function write(
  encounterId: string,
  data: ClinicalContent = note,
  supersedesId: string | null = null,
  patient = f.patientId,
) {
  const result = await mutate(`/api/v1/clinical/patients/${patient}/records`, {
    encounterId,
    data,
    supersedesId,
    reason: 'Fictional clinical change',
  });
  expect(result.status, result.text).toBe(200);
  return ClinicalRecordSchema.parse(result.body);
}
async function approve(id: string) {
  const result = await mutate(`/api/v1/clinical/records/${id}/review`, {
    decision: 'approved',
    reason: 'Fictional clinician approval',
  });
  expect(result.status, result.text).toBe(200);
}
async function workspace(patient = f.patientId, asOf?: string) {
  return ClinicalWorkspaceSchema.parse(
    (
      await get(`/api/v1/clinical/patients/${patient}${asOf ? `?encounterId=${asOf}` : ''}`).expect(
        200,
      )
    ).body,
  );
}
const portal = async (role = 'patient') =>
  ClinicalPortalSchema.parse((await get('/api/v1/clinical/portal', role).expect(200)).body);

describe('clinical workflow on production API and PostgreSQL', () => {
  it('fails closed on a regressed server clock without rewriting clinical times or committing changes', async () => {
    const patientId = randomUUID();
    await f.database.pool.query(
      "INSERT INTO patients(id,clinic_id,medical_record_number,given_name,family_name) VALUES($1,$2,$3,'Fictional','Clock Test')",
      [patientId, f.clinicId, `CLOCK-${patientId}`],
    );
    const open = await encounter(patientId);
    const pending = await write(open.id, note, null, patientId);
    const empty = await encounter(patientId);
    // Fictional legacy history from a future clock simulates rollback without changing host time.
    await f.database.pool.query(
      "INSERT INTO encounters(clinic_id,patient_id,provider_id,started_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
      [f.clinicId, patientId, f.providerId],
    );
    const before = await f.database.pool.query(
      "SELECT count(*)::int AS count FROM audit_events WHERE data->>'patientId'=$1",
      [patientId],
    );
    for (const [path, body] of [
      [
        `/api/v1/clinical/patients/${patientId}/encounters`,
        { reason: 'Fictional retry', appointmentId: null },
      ],
      [
        `/api/v1/clinical/patients/${patientId}/records`,
        { encounterId: open.id, supersedesId: null, reason: 'Fictional retry', data: note },
      ],
      [
        `/api/v1/clinical/records/${pending.id}/review`,
        { decision: 'approved', reason: 'Fictional retry' },
      ],
      [`/api/v1/clinical/encounters/${empty.id}/close`, { reason: 'Fictional retry' }],
    ] as const) {
      const response = await mutate(path, body);
      expect(response.status, response.text).toBe(409);
      expect(response.body.error.code).toBe('CLINICAL_CLOCK_CONFLICT');
    }
    expect((await workspace(patientId)).history).toHaveLength(1);
    expect((await workspace(patientId)).encounters.every((e) => e.status === 'open')).toBe(true);
    expect((await workspace(patientId)).history[0]?.approval).toBe('pending');
    const after = await f.database.pool.query(
      "SELECT count(*)::int AS count FROM audit_events WHERE data->>'patientId'=$1",
      [patientId],
    );
    expect(after.rows).toEqual(before.rows);
  });
  it('keeps drafts private, publishes only approved projection, and retains corrections', async () => {
    const e = await encounter();
    const first = await write(e.id);
    expect((await portal()).records.some((r) => r.id === first.id)).toBe(false);
    await approve(first.id);
    const published = (await portal()).records.find((r) => r.id === first.id)!;
    expect(published.data).toEqual(note);
    expect(published).not.toHaveProperty('reason');
    expect(published).not.toHaveProperty('reviewReason');
    expect(published).not.toHaveProperty('groupId');
    const correction = await write(
      e.id,
      { ...note, body: 'Fictional corrected progress note' },
      first.id,
    );
    expect(correction.version).toBe(2);
    expect((await portal()).records.some((r) => r.id === first.id)).toBe(true);
    expect((await portal()).records.some((r) => r.id === correction.id)).toBe(false);
    await approve(correction.id);
    const projected = await portal();
    expect(projected.records.some((r) => r.id === first.id)).toBe(false);
    expect(projected.records.some((r) => r.id === correction.id)).toBe(true);
    expect(projected.history.filter((r) => [first.id, correction.id].includes(r.id))).toHaveLength(
      2,
    );
    const full = await workspace();
    expect(full.history.filter((r) => r.groupId === first.groupId)).toHaveLength(2);
  });
  it('reconstructs the odontogram before a later encounter and forbids edits to closed visits', async () => {
    const e1 = await encounter();
    const first = await write(e1.id, finding);
    await approve(first.id);
    await mutate(`/api/v1/clinical/encounters/${e1.id}/close`, {
      reason: 'Fictional visit complete',
    }).then((r) => expect(r.status, r.text).toBe(200));
    const e2 = await encounter();
    const resolved = await write(e2.id, { ...finding, status: 'resolved' }, first.id);
    await approve(resolved.id);
    const historical = await workspace(f.patientId, e1.id);
    expect(historical.records.find((r) => r.groupId === first.groupId)?.data).toEqual(finding);
    expect((await workspace()).records.find((r) => r.groupId === first.groupId)?.data).toEqual({
      ...finding,
      status: 'resolved',
    });
    const oldPortal = ClinicalPortalSchema.parse(
      (await get(`/api/v1/clinical/portal?encounterId=${e1.id}`, 'patient').expect(200)).body,
    );
    expect(oldPortal.records.some((r) => r.id === first.id)).toBe(true);
    expect(oldPortal.history.some((r) => r.id === resolved.id)).toBe(false);
    const result = await mutate(`/api/v1/clinical/patients/${f.patientId}/records`, {
      encounterId: e1.id,
      data: note,
      supersedesId: null,
      reason: 'Fictional old visit edit',
    });
    expect(result.status).toBe(409);
  });
  it('requires review before closing, prevents repeated approval, and excludes rejected content', async () => {
    const e = await encounter();
    const r = await write(e.id);
    expect(
      (await mutate(`/api/v1/clinical/encounters/${e.id}/close`, { reason: 'Fictional closure' }))
        .status,
    ).toBe(409);
    expect(
      (
        await mutate(`/api/v1/clinical/records/${r.id}/review`, {
          decision: 'rejected',
          reason: 'Fictional rejection',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(`/api/v1/clinical/records/${r.id}/review`, {
          decision: 'approved',
          reason: 'Fictional repeat',
        })
      ).status,
    ).toBe(409);
    expect((await portal()).history.some((p) => p.id === r.id)).toBe(false);
    expect(
      (await mutate(`/api/v1/clinical/encounters/${e.id}/close`, { reason: 'Fictional closure' }))
        .status,
    ).toBe(200);
  });
  it('stores demographic, alert, allergy and medication revisions without JSON-only truth', async () => {
    const e = await encounter();
    const contents: ClinicalContent[] = [
      {
        kind: 'demographics',
        givenName: 'Fictional',
        familyName: 'Updated patient',
        preferredName: null,
        dateOfBirth: '2000-01-01',
        phone: null,
        email: 'fictional@example.test',
      },
      {
        kind: 'alert',
        title: 'Fictional medical alert',
        severity: 'warning',
        active: true,
        details: 'Fictional details',
      },
      {
        kind: 'allergy',
        substance: 'Fictional allergen',
        reaction: 'Fictional reaction',
        severity: 'Fictional severity',
        status: 'active',
      },
      {
        kind: 'medication',
        medicationName: 'Fictional medication',
        dose: 'Fictional dose',
        route: 'Fictional route',
        frequency: 'Fictional frequency',
        status: 'active',
      },
    ];
    for (const data of contents) {
      const r = await write(e.id, data);
      await approve(r.id);
      expect((await portal()).records.find((p) => p.id === r.id)?.data).toEqual(data);
    }
    expect(
      (await f.database.pool.query('SELECT family_name FROM patients WHERE id=$1', [f.patientId]))
        .rows[0]?.family_name,
    ).toBe('Updated patient');
    const med = await write(e.id, {
      kind: 'medication',
      medicationName: 'Fictional temporary',
      dose: null,
      route: null,
      frequency: null,
      status: 'active',
    });
    await approve(med.id);
    const stopped = await write(
      e.id,
      { ...med.data, status: 'stopped' } as ClinicalContent,
      med.id,
    );
    await approve(stopped.id);
    expect(
      (await f.database.pool.query('SELECT status FROM medications WHERE id=$1', [med.id])).rows[0]
        ?.status,
    ).toBe('active');
  });
  it('versions procedures, normalized treatment items and surfaces with valid transitions', async () => {
    const e = await encounter();
    const p: ClinicalContent = {
      kind: 'procedure',
      toothCode: '16',
      surfaces: ['O'],
      procedureCode: 'restoration',
      description: 'Fictional restoration',
      status: 'planned',
    };
    const planned = await write(e.id, p);
    await approve(planned.id);
    const completed = await write(e.id, { ...p, status: 'completed' }, planned.id);
    await approve(completed.id);
    const invalid = await mutate(`/api/v1/clinical/patients/${f.patientId}/records`, {
      encounterId: e.id,
      data: p,
      supersedesId: completed.id,
      reason: 'Fictional invalid transition',
    });
    expect(invalid.status).toBe(409);
    const amendment = await write(
      e.id,
      { ...p, status: 'completed', description: 'Fictional corrected description' },
      completed.id,
    );
    const performanceDates = (
      await f.database.pool.query<{ id: string; performed_at: Date }>(
        'SELECT id,performed_at FROM procedures WHERE id=ANY($1::uuid[])',
        [[completed.id, amendment.id]],
      )
    ).rows;
    expect(performanceDates[0]!.performed_at.toISOString()).toBe(
      performanceDates[1]!.performed_at.toISOString(),
    );
    const service = randomUUID();
    await f.database.pool.query(
      "INSERT INTO services(id,clinic_id,code,name) VALUES($1::uuid,$2,$1::uuid::text,'Fictional service')",
      [service, f.clinicId],
    );
    const plan: ClinicalContent = {
      kind: 'plan',
      name: 'Fictional plan',
      status: 'draft',
      items: [
        {
          serviceId: service,
          toothCode: '16',
          surfaces: ['M', 'O'],
          description: 'Fictional item',
          quantity: 1,
          estimatedAmountMinor: 12500,
          currency: 'USD',
          status: 'planned',
        },
      ],
    };
    const r = await write(e.id, plan);
    await approve(r.id);
    expect((await workspace()).records.find((p) => p.id === r.id)?.data).toEqual(plan);
    expect(
      (
        await f.database.pool.query(
          'SELECT 1 FROM treatment_plan_item_surfaces s JOIN treatment_plan_items i ON i.id=s.item_id WHERE i.treatment_plan_id=$1',
          [r.id],
        )
      ).rowCount,
    ).toBe(2);
    const presented = await write(e.id, { ...plan, status: 'presented' }, r.id);
    await approve(presented.id);
    const accepted = await write(e.id, { ...plan, status: 'accepted' }, presented.id);
    await approve(accepted.id);
    expect((await workspace()).records.find((record) => record.id === accepted.id)?.data).toEqual({
      ...plan,
      status: 'accepted',
    });
  });
  it.each(['clinic_owner', 'clinic_admin', 'receptionist', 'patient', 'patient2'])(
    'denies clinician resources to %s',
    async (role) => {
      const e = await encounter();
      const r = await write(e.id);
      expect((await get('/api/v1/clinical/patients', role)).status).toBe(403);
      expect((await get(`/api/v1/clinical/patients/${f.patientId}`, role)).status).toBe(403);
      for (const [path, body] of [
        [`patients/${f.patientId}/encounters`, { reason: 'Fictional', appointmentId: null }],
        [
          `patients/${f.patientId}/records`,
          { encounterId: e.id, data: note, supersedesId: null, reason: 'Fictional' },
        ],
        [`records/${r.id}/review`, { decision: 'approved', reason: 'Fictional' }],
        [`encounters/${e.id}/close`, { reason: 'Fictional' }],
      ] as const)
        expect((await mutate(`/api/v1/clinical/${path}`, body, role)).status).toBe(403);
    },
  );
  it('denies every cross-clinic resource, including valid dentist credentials and historical selectors', async () => {
    const e = await encounter();
    const r = await write(e.id);
    await approve(r.id);
    expect((await get(`/api/v1/clinical/patients/${f.patientId}`, 'foreign')).status).toBe(404);
    for (const [path, body] of [
      [`patients/${f.patientId}/encounters`, { reason: 'Fictional', appointmentId: null }],
      [
        `patients/${f.patientId}/records`,
        { encounterId: e.id, data: note, supersedesId: null, reason: 'Fictional' },
      ],
      [
        `patients/${f.foreignPatientId}/records`,
        { encounterId: e.id, data: note, supersedesId: null, reason: 'Fictional' },
      ],
      [`records/${r.id}/review`, { decision: 'approved', reason: 'Fictional' }],
      [`encounters/${e.id}/close`, { reason: 'Fictional' }],
    ] as const)
      expect((await mutate(`/api/v1/clinical/${path}`, body, 'foreign')).status).toBe(404);
    expect((await get(`/api/v1/clinical/portal?encounterId=${e.id}`, 'foreign')).status).toBe(404);
    expect((await portal('patient2')).history.some((p) => p.id === r.id)).toBe(false);
    expect((await get(`/api/v1/clinical/portal?patientId=${f.patientId}`, 'patient2')).status).toBe(
      400,
    );
    expect((await get('/api/v1/clinical/portal', 'dentist')).status).toBe(403);
  });
  it('rejects invalid teeth/surfaces, patient mismatches and authority overrides', async () => {
    const e = await encounter();
    for (const data of [
      { ...finding, toothCode: '99' },
      { ...finding, toothCode: '11' },
      { ...finding, surfaces: ['I'] },
      { ...finding, surfaces: ['O', 'O'] },
      { ...finding, status: 'invented' },
    ])
      expect(
        (
          await mutate(`/api/v1/clinical/patients/${f.patientId}/records`, {
            encounterId: e.id,
            data,
            supersedesId: null,
            reason: 'Fictional',
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await mutate(`/api/v1/clinical/patients/${f.secondPatientId}/records`, {
          encounterId: e.id,
          data: note,
          supersedesId: null,
          reason: 'Fictional',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await mutate(`/api/v1/clinical/patients/${f.patientId}/records`, {
          encounterId: e.id,
          data: note,
          supersedesId: null,
          reason: 'Fictional',
          authorMembershipId: randomUUID(),
          approval: 'approved',
          clinicId: f.clinicId,
        })
      ).status,
    ).toBe(400);
  });
  it('allows exactly one concurrent successor and one concurrent approval', async () => {
    const e = await encounter();
    const original = await write(e.id);
    await approve(original.id);
    const results = await Promise.all(
      [1, 2].map((i) =>
        mutate(`/api/v1/clinical/patients/${f.patientId}/records`, {
          encounterId: e.id,
          data: { ...note, body: `Fictional concurrent correction ${i}` },
          supersedesId: original.id,
          reason: 'Fictional correction',
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const successor = ClinicalRecordSchema.parse(results.find((r) => r.status === 200)!.body);
    const approvals = await Promise.all(
      [1, 2].map(() =>
        mutate(`/api/v1/clinical/records/${successor.id}/review`, {
          decision: 'approved',
          reason: 'Fictional approval',
        }),
      ),
    );
    expect(approvals.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (
        await mutate(`/api/v1/clinical/records/${original.id}/review`, {
          decision: 'approved',
          reason: 'Fictional stale approval',
        })
      ).status,
    ).toBe(409);
  });
  it('rolls back clinical payload, header and publication if audit writing fails', async () => {
    const e = await encounter();
    const before = (await workspace()).history.length;
    await f.database.pool.query(
      `CREATE FUNCTION reject_phase8_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'clinical.%' THEN RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_phase8_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_phase8_audit()`,
    );
    try {
      const result = await mutate(`/api/v1/clinical/patients/${f.patientId}/records`, {
        encounterId: e.id,
        data: note,
        supersedesId: null,
        reason: 'Fictional rollback',
      });
      expect(result.status).toBe(503);
      expect(JSON.stringify(result.body)).not.toContain('fictional audit failure');
      expect((await workspace()).history).toHaveLength(before);
    } finally {
      await f.database.pool.query(
        'DROP TRIGGER reject_phase8_audit ON audit_events; DROP FUNCTION reject_phase8_audit()',
      );
    }
    const r = await write(e.id);
    await f.database.pool.query(
      `CREATE FUNCTION reject_phase8_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='clinical.approved' THEN RAISE EXCEPTION 'fictional review audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_phase8_review BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_phase8_review()`,
    );
    try {
      expect(
        (
          await mutate(`/api/v1/clinical/records/${r.id}/review`, {
            decision: 'approved',
            reason: 'Fictional rollback',
          })
        ).status,
      ).toBe(503);
      expect((await portal()).records.some((p) => p.id === r.id)).toBe(false);
    } finally {
      await f.database.pool.query(
        'DROP TRIGGER reject_phase8_review ON audit_events; DROP FUNCTION reject_phase8_review()',
      );
    }
  });
  it('protects immutable database history and records required audit provenance', async () => {
    const e = await encounter();
    const r = await write(e.id, finding);
    await approve(r.id);
    for (const sql of [
      "UPDATE clinical_revisions SET reason='overwrite' WHERE id=$1",
      'DELETE FROM clinical_revisions WHERE id=$1',
      "UPDATE odontogram_findings SET finding_code='healthy' WHERE id=$1",
      'DELETE FROM odontogram_finding_surfaces WHERE finding_id=$1',
      'DELETE FROM clinical_approvals WHERE revision_id=$1',
    ])
      await expect(f.database.pool.query(sql, [r.id])).rejects.toMatchObject({ code: '55000' });
    await expect(
      f.database.pool.query(
        "INSERT INTO odontogram_finding_surfaces(clinic_id,finding_id,surface_code) VALUES($1,$2,'M')",
        [f.clinicId, r.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    const audit = (
      await f.database.pool.query(
        'SELECT * FROM audit_events WHERE entity_id=$1 ORDER BY occurred_at',
        [r.id],
      )
    ).rows;
    expect(audit).toHaveLength(2);
    const matchedTimes = await f.database.pool.query<{ matched: boolean }>(
      `SELECT CASE WHEN e.action='clinical.created' THEN e.occurred_at=r.recorded_at
        ELSE e.occurred_at=a.reviewed_at END AS matched FROM audit_events e
        JOIN clinical_revisions r ON r.clinic_id=e.clinic_id AND r.id=e.entity_id
        JOIN clinical_approvals a ON a.clinic_id=r.clinic_id AND a.revision_id=r.id WHERE r.id=$1`,
      [r.id],
    );
    expect(matchedTimes.rows).toEqual([{ matched: true }, { matched: true }]);
    for (const event of audit) {
      expect(event.clinic_id).toBe(f.clinicId);
      expect(event.actor_membership_id).toBe(f.members['dentist']!.membershipId);
      expect(event.occurred_at).toBeInstanceOf(Date);
      expect(event.data.patientId).toBe(f.patientId);
      expect(event.data.reason).toBeTruthy();
      expect(event.data).toHaveProperty('before');
      expect(event.data).toHaveProperty('after');
    }
  });
  it('enforces required normalized payloads, tenancy and FDI surfaces directly at commit', async () => {
    const e = await encounter();
    const insert = async (tooth: string | undefined, surface = 'O', clinic = f.clinicId) => {
      const db = await f.database.pool.connect();
      const id = randomUUID();
      try {
        await db.query('BEGIN');
        await db.query(
          "INSERT INTO clinical_revisions(id,clinic_id,patient_id,encounter_id,kind,group_id,version,author_membership_id,reason) VALUES($1,$2,$3,$4,'finding',$1,1,$5,'Fictional constraint test')",
          [id, clinic, f.patientId, e.id, f.members['dentist']!.membershipId],
        );
        if (tooth) {
          await db.query(
            "INSERT INTO odontogram_findings(id,clinic_id,patient_id,encounter_id,tooth_code,dentition,finding_code,recorded_by_membership_id) VALUES($1,$2,$3,$4,$5,'permanent','caries',$6)",
            [id, clinic, f.patientId, e.id, tooth, f.members['dentist']!.membershipId],
          );
          await db.query(
            'INSERT INTO odontogram_finding_surfaces(clinic_id,finding_id,surface_code) VALUES($1,$2,$3)',
            [clinic, id, surface],
          );
        }
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
        db.release();
      }
    };
    await expect(insert(undefined)).rejects.toMatchObject({ code: '23514' });
    await expect(insert('99')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('11', 'O')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('16', 'I')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('16', 'O', f.otherClinicId)).rejects.toMatchObject({ code: '23503' });
  });
  it('retains earlier normalized clinical content as an explicit clinician-only archive', async () => {
    const e = await encounter();
    const legacyId = randomUUID();
    await f.database.pool.query(
      "INSERT INTO clinical_notes(id,clinic_id,patient_id,encounter_id,note_group_id,version,status,note_type,body,authored_by_membership_id,signed_at) VALUES($1,$2,$3,$4,$1,1,'signed','legacy','Fictional retained legacy note',$5,now())",
      [legacyId, f.clinicId, f.patientId, e.id, f.members['dentist']!.membershipId],
    );
    const w = await workspace();
    expect(w.legacyRecords.find((r) => r.id === legacyId)?.fields).toContainEqual({
      name: 'body',
      value: 'Fictional retained legacy note',
    });
    expect(w.records.some((r) => r.id === legacyId)).toBe(false);
    expect((await portal()).history.some((r) => r.id === legacyId)).toBe(false);
    expect((await workspace(f.secondPatientId)).legacyRecords.some((r) => r.id === legacyId)).toBe(
      false,
    );
  });
  it('rejects unaudited clinical publication at the database boundary', async () => {
    const e = await encounter();
    const r = await write(e.id);
    await expect(
      f.database.pool.query(
        "INSERT INTO clinical_approvals(clinic_id,revision_id,decision,reviewer_membership_id,reason) VALUES($1,$2,'approved',$3,'Fictional unaudited approval')",
        [f.clinicId, r.id, f.members['dentist']!.membershipId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect((await portal()).records.some((p) => p.id === r.id)).toBe(false);
  });
  it('returns safe errors for malformed selectors and oversized clinical content', async () => {
    expect((await get('/api/v1/clinical/patients/not-a-uuid')).status).toBe(400);
    expect((await get(`/api/v1/clinical/patients/${f.patientId}?encounterId=invalid`)).status).toBe(
      400,
    );
    const result = await mutate(`/api/v1/clinical/patients/${f.patientId}/records`, {
      data: { kind: 'note', body: 'x'.repeat(110000) },
    });
    expect(result.status).toBe(413);
    expect(result.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(result.body.error).not.toHaveProperty('stack');
  });
  it('denies revoked sessions and inactive clinician provider records', async () => {
    await f.database.pool.query('UPDATE providers SET active=false WHERE id=$1', [f.providerId]);
    try {
      expect((await get('/api/v1/clinical/patients')).status).toBe(403);
    } finally {
      await f.database.pool.query('UPDATE providers SET active=true WHERE id=$1', [f.providerId]);
    }
    expect((await request(f.app).get('/api/v1/clinical/patients')).status).toBe(401);
    await f.database.pool.query('DELETE FROM auth_sessions WHERE user_id=$1', [
      f.members['patient2']!.userId,
    ]);
    expect((await get('/api/v1/clinical/portal', 'patient2')).status).toBe(401);
  });
});
