import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { hashPassword } from 'better-auth/crypto';
import { assessAnesthesia } from '@dentalai/domain';

export const developmentId = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const developmentClinicId = developmentId(1);
export const developmentAccounts = [
  { role: 'clinic_owner', user: 21, member: 121, email: 'owner@example.invalid' },
  { role: 'clinic_admin', user: 22, member: 122, email: 'admin@example.invalid' },
  { role: 'dentist', user: 4, member: 6, email: 'dentist@example.invalid' },
  { role: 'receptionist', user: 23, member: 123, email: 'receptionist@example.invalid' },
  { role: 'patient', user: 24, member: 124, email: 'patient@example.invalid' },
  { role: 'dentist', user: 30, member: 130, email: 'dentist2@example.invalid' },
] as const;
const samplePrices = [
  ['cavity', 50000],
  ['filling', 150000],
  ['extracted', 100000],
  ['root_canal', 450000],
  ['crown', 800000],
  ['implant', 1200000],
] as const;
const reason = 'Phase 12 synthetic development seed; not patient data';

export function assertLocalDevelopmentDatabase(url: string, nodeEnv: string) {
  const parsed = new URL(url);
  if (nodeEnv !== 'development' && nodeEnv !== 'test')
    throw new Error('Development seeding is prohibited outside development/test.');
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    !['postgres:', 'postgresql:'].includes(parsed.protocol)
  )
    throw new Error('Development seeding requires an explicitly local PostgreSQL URL.');
  if (['/postgres', '/template0', '/template1', '/'].includes(parsed.pathname))
    throw new Error('Use a dedicated development database, not a maintenance database.');
}

/** Add-only deterministic fixtures. Does not drop databases or overwrite existing identities/history. */
export async function seedLocalDevelopment(url: string, password: string, nodeEnv = 'development') {
  assertLocalDevelopmentDatabase(url, nodeEnv);
  if (password.length < 12 || password.length > 128)
    throw new Error('Development password must be 12–128 characters.');
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = await pool.connect();
  const id = developmentId,
    c = developmentClinicId;
  const insert = async (table: string, columns: string, values: unknown[]) => {
    // Table/column strings are constants in this operator-only source, not browser input.
    await db.query(
      `INSERT INTO ${table} (${columns}) VALUES(${values.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT ${columns.split(',').includes('id') ? '(id)' : ''} DO NOTHING`,
      values,
    );
  };
  const exists = async (table: string, key: string) =>
    !!(await db.query(`SELECT 1 FROM ${table} WHERE id=$1`, [key])).rowCount;
  const audit = async (n: number, action: string, entity: string, member: number, data: object) =>
    insert(
      'audit_events',
      'id,clinic_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,data',
      [
        id(n),
        c,
        id(member === 6 ? 4 : 21),
        id(member),
        action,
        'development_fixture',
        entity,
        JSON.stringify(data),
      ],
    );
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('dentalai:local-seed-v12',0))");
    const existing = await db.query<{ default_currency: string; slug: string }>(
      'SELECT default_currency,slug FROM clinics WHERE id=$1',
      [c],
    );
    if (
      existing.rowCount &&
      (existing.rows[0]?.default_currency !== 'SYP' ||
        existing.rows[0]?.slug !== 'harbor-demo-dental')
    )
      throw new Error(
        'Default tenant already contains a different seed/configuration. Use a fresh development database; no currency relabeling or overwrite is performed.',
      );
    await insert('clinics', 'id,legal_name,display_name,slug,default_timezone,default_currency', [
      c,
      'Fictional Harbor Development Clinic',
      'Harbor Demo Dental',
      'harbor-demo-dental',
      'Etc/UTC',
      'SYP',
    ]);
    await insert(
      'clinic_settings',
      'clinic_id,appointment_lead_minutes,appointment_horizon_days,settings',
      [
        c,
        0,
        365,
        JSON.stringify({
          developmentSeed: 'phase12-synthetic-v1',
          dataClassification: 'synthetic',
          currencyPolicy: 'SYP numeric values 1:1; no FX conversion',
        }),
      ],
    );
    await insert('locations', 'id,clinic_id,name,timezone', [
      id(2),
      c,
      'Fictional Harbor Office',
      'Etc/UTC',
    ]);
    await insert('operatories', 'id,clinic_id,location_id,name', [id(3), c, id(2), 'Demo chair 1']);
    const roles = ['clinic_owner', 'clinic_admin', 'dentist', 'receptionist', 'patient'];
    for (const [index, role] of roles.entries())
      await insert('roles', 'id,clinic_id,key,name', [id(101 + index), c, role, role]);
    for (const account of developmentAccounts) {
      const prior = await db.query<{ email: string }>('SELECT email FROM users WHERE id=$1', [
        id(account.user),
      ]);
      if (prior.rowCount && prior.rows[0]?.email !== account.email)
        throw new Error('Seed identity conflict; existing user was not modified.');
      const emailOwner = await db.query<{ id: string }>(
        'SELECT id FROM users WHERE lower(email)=lower($1)',
        [account.email],
      );
      if (emailOwner.rowCount && emailOwner.rows[0]?.id !== id(account.user))
        throw new Error('Seed email conflict; existing user was not adopted.');
      await insert('users', 'id,email,display_name,email_verified,email_verified_at', [
        id(account.user),
        account.email,
        `Fictional ${account.role}`,
        true,
        '2026-01-01T00:00:00Z',
      ]);
      // Maintained server hashing; no legacy hashes, known default password, tokens or sessions imported.
      if (!(await exists('auth_accounts', id(300 + account.user))))
        await insert(
          'auth_accounts',
          'id,user_id,account_id,provider_id,password,created_at,updated_at',
          [
            id(300 + account.user),
            id(account.user),
            id(account.user),
            'credential',
            await hashPassword(password),
            '2026-01-01T00:00:00Z',
            '2026-01-01T00:00:00Z',
          ],
        );
      await insert('memberships', 'id,clinic_id,user_id,status,joined_at', [
        id(account.member),
        c,
        id(account.user),
        'active',
        '2026-01-01T00:00:00Z',
      ]);
      await insert('membership_roles', 'clinic_id,membership_id,role_id', [
        c,
        id(account.member),
        id(101 + roles.indexOf(account.role)),
      ]);
    }
    for (const [staff, member, provider] of [
      [7, 6, 8],
      [131, 130, 132],
    ]) {
      await insert('staff', 'id,clinic_id,membership_id,kind', [
        id(staff!),
        c,
        id(member!),
        'provider',
      ]);
      await insert('providers', 'id,clinic_id,staff_id,provider_type', [
        id(provider!),
        c,
        id(staff!),
        'dentist',
      ]);
    }
    await insert('staff', 'id,clinic_id,membership_id,kind', [id(133), c, id(123), 'staff']);
    await insert(
      'patients',
      'id,clinic_id,portal_user_id,medical_record_number,given_name,family_name,email',
      [id(9), c, id(24), 'DEMO-0001', 'Mina', 'Example', 'patient@example.invalid'],
    );
    await insert('patients', 'id,clinic_id,medical_record_number,given_name,family_name', [
      id(10),
      c,
      'DEMO-0002',
      'Samir',
      'Sample',
    ]);
    for (let weekday = 1; weekday <= 5; weekday++)
      for (const provider of [8, 132])
        await insert(
          'working_hours',
          'id,clinic_id,location_id,provider_id,weekday,opens_at_local,closes_at_local',
          [
            id(200 + weekday + (provider === 132 ? 10 : 0)),
            c,
            id(2),
            id(provider),
            weekday,
            '09:00',
            '17:00',
          ],
        );
    await insert('appointment_types', 'id,clinic_id,name,code,default_duration_minutes', [
      id(12),
      c,
      'Fictional examination',
      'DEMO-EXAM',
      30,
    ]);
    for (const [n, status, start, end, patient] of [
      [16, 'confirmed', '2030-01-07T09:00:00Z', '2030-01-07T09:30:00Z', 9],
      [17, 'completed', '2026-01-05T09:00:00Z', '2026-01-05T09:30:00Z', 9],
      [18, 'scheduled', '2026-10-12T10:00:00Z', '2026-10-12T10:30:00Z', 10],
    ] as const)
      if (!(await exists('appointments', id(n)))) {
        await insert(
          'appointments',
          'id,clinic_id,location_id,operatory_id,patient_id,provider_id,appointment_type_id,status,starts_at,ends_at,timezone,reason,created_by_membership_id',
          [
            id(n),
            c,
            id(2),
            id(3),
            id(patient),
            id(8),
            id(12),
            status,
            start,
            end,
            'Etc/UTC',
            reason,
            id(6),
          ],
        );
        await insert(
          'appointment_status_history',
          'id,clinic_id,appointment_id,to_status,reason,changed_by_membership_id,occurred_at',
          [id(400 + n), c, id(n), status, reason, id(6), start],
        );
        await audit(500 + n, 'development.appointment_created', id(n), 6, {
          synthetic: true,
          status,
        });
      }
    for (const [index, [code, amount]] of samplePrices.entries()) {
      await insert('services', 'id,clinic_id,code,name', [
        id(600 + index),
        c,
        code,
        `Fictional ${code} service`,
      ]);
      if (index === 0)
        await insert('price_lists', 'id,clinic_id,name,currency,effective_from', [
          id(14),
          c,
          'Synthetic SYP prices',
          'SYP',
          '2026-01-01T00:00:00Z',
        ]);
      if (!(await exists('price_list_items', id(620 + index))))
        await insert(
          'price_list_items',
          'id,clinic_id,price_list_id,service_id,amount_minor,currency',
          [id(620 + index), c, id(14), id(600 + index), amount, 'SYP'],
        );
    }
    if (
      !(await db.query('SELECT 1 FROM billing_price_publications WHERE price_list_id=$1', [id(14)]))
        .rowCount
    ) {
      await insert(
        'billing_price_publications',
        'price_list_id,clinic_id,currency,author_membership_id,reason',
        [id(14), c, 'SYP', id(121), reason],
      );
      await audit(700, 'billing.price_published', id(14), 121, {
        reason,
        before: null,
        after: { synthetic: true, currency: 'SYP' },
      });
    }
    if (!(await exists('encounters', id(40)))) {
      await insert('encounters', 'id,clinic_id,patient_id,appointment_id,provider_id,started_at', [
        id(40),
        c,
        id(9),
        id(17),
        id(8),
        '2026-01-05T09:00:00Z',
      ]);
      await insert(
        'clinical_encounter_provenance',
        'encounter_id,clinic_id,author_membership_id,reason',
        [id(40), c, id(6), reason],
      );
      await audit(740, 'clinical.encounter_started', id(40), 6, {
        patientId: id(9),
        reason,
        before: null,
        after: { synthetic: true },
      });
    }
    await seedClinical(db, insert, exists, audit);
    await seedInvoice(db, insert, exists, audit, 50, 150000, false);
    await seedInvoice(db, insert, exists, audit, 51, 50000, true);
    await insert('xray_studies', 'id,clinic_id,patient_id,study_type,notes', [
      id(80),
      c,
      id(9),
      'synthetic-metadata-only',
      'Synthetic metadata only. No clinical image, acquisition time, AI finding or diagnostic result.',
    ]);
    if (!(await exists('anesthesia_assessments', id(81)))) {
      const history = { reviewed: false, items: [] };
      const input = {
        age: null,
        weight: null,
        solution: null,
        bloodPressure: null,
        allergies: history,
        medications: history,
        pregnancy: 'unknown',
        smoking: 'unknown',
        hepaticConditions: history,
        renalConditions: history,
        cardiovascularConditions: history,
        otherContraindications: history,
        exposure: { reviewed: false, doses: [] },
      };
      const output = assessAnesthesia(input);
      await insert(
        'anesthesia_assessments',
        'id,clinic_id,patient_id,provider_id,rule_set_version,inputs,modeled_output',
        [
          id(81),
          c,
          id(9),
          id(8),
          output.ruleSetVersion,
          JSON.stringify({
            input,
            provenance: {
              source: 'clinician_record_review',
              observedAt: '2026-01-05T09:00:00Z',
              authorUserId: id(4),
              providerId: id(8),
              reason,
              requestId: 'development-seed-v12',
            },
          }),
          JSON.stringify(output),
        ],
      );
      await audit(781, 'anesthesia.assessed', id(81), 6, {
        patientId: id(9),
        reason,
        before: null,
        after: output,
        synthetic: true,
      });
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
    await pool.end();
  }
}

type Insert = (table: string, columns: string, values: unknown[]) => Promise<void>;
type Exists = (table: string, key: string) => Promise<boolean>;
type Audit = (
  n: number,
  action: string,
  entity: string,
  member: number,
  data: object,
) => Promise<void>;
async function seedClinical(_db: PoolClient, insert: Insert, exists: Exists, audit: Audit) {
  const id = developmentId,
    c = developmentClinicId;
  for (const [n, kind] of [
    [41, 'note'],
    [42, 'finding'],
    [43, 'procedure'],
    [44, 'plan'],
  ] as const) {
    if (await exists('clinical_revisions', id(n))) continue;
    await insert(
      'clinical_revisions',
      'id,clinic_id,patient_id,encounter_id,kind,group_id,version,author_membership_id,reason,recorded_at',
      [id(n), c, id(9), id(40), kind, id(n), 1, id(6), reason, `2026-01-05T09:${n - 30}:00Z`],
    );
    if (kind === 'note')
      await insert(
        'clinical_notes',
        'id,clinic_id,patient_id,encounter_id,note_group_id,version,status,note_type,body,authored_by_membership_id',
        [
          id(n),
          c,
          id(9),
          id(40),
          id(n),
          1,
          'draft',
          'progress',
          'Fictional software fixture. No actual clinical care or diagnosis.',
          id(6),
        ],
      );
    if (kind === 'finding') {
      await insert(
        'odontogram_findings',
        'id,clinic_id,patient_id,encounter_id,tooth_code,dentition,finding_code,details,recorded_by_membership_id',
        [
          id(n),
          c,
          id(9),
          id(40),
          '16',
          'permanent',
          'caries',
          'Synthetic odontogram fixture; not an actual finding.',
          id(6),
        ],
      );
      await insert('odontogram_finding_surfaces', 'clinic_id,finding_id,surface_code', [
        c,
        id(n),
        'O',
      ]);
    }
    if (kind === 'procedure') {
      await insert(
        'procedures',
        'id,clinic_id,patient_id,encounter_id,tooth_code,dentition,procedure_code,status,description,provider_id,performed_at',
        [
          id(n),
          c,
          id(9),
          id(40),
          '16',
          'permanent',
          'restoration',
          'completed',
          'Synthetic procedure only.',
          id(8),
          '2026-01-05T09:13:00Z',
        ],
      );
      await insert('procedure_surfaces', 'clinic_id,procedure_id,surface_code', [c, id(n), 'O']);
      await insert(
        'procedure_status_history',
        'id,clinic_id,procedure_id,to_status,changed_by_membership_id,reason',
        [id(843), c, id(n), 'completed', id(6), reason],
      );
    }
    if (kind === 'plan') {
      await insert('treatment_plans', 'id,clinic_id,patient_id,provider_id,name', [
        id(n),
        c,
        id(9),
        id(8),
        'Synthetic treatment plan',
      ]);
      await insert(
        'treatment_plan_items',
        'id,clinic_id,treatment_plan_id,service_id,sequence,tooth_code,description,estimated_amount_minor,currency',
        [id(45), c, id(n), id(600), 1, '16', 'Synthetic sample item', 50000, 'SYP'],
      );
      await insert('treatment_plan_item_surfaces', 'clinic_id,item_id,surface_code', [
        c,
        id(45),
        'O',
      ]);
    }
    await audit(750 + n, 'clinical.created', id(n), 6, {
      patientId: id(9),
      reason,
      before: null,
      after: { synthetic: true, kind },
    });
  }
}
async function seedInvoice(
  db: PoolClient,
  insert: Insert,
  exists: Exists,
  audit: Audit,
  n: number,
  amount: number,
  issued: boolean,
) {
  const id = developmentId,
    c = developmentClinicId;
  if (await exists('invoices', id(n))) return;
  await insert(
    'invoices',
    'id,clinic_id,patient_id,invoice_number,currency,subtotal_minor,total_minor,balance_minor,created_by_membership_id',
    [id(n), c, id(9), `SYNTHETIC-${n}`, 'SYP', amount, amount, amount, id(121)],
  );
  await insert(
    'invoice_items',
    'id,clinic_id,invoice_id,service_id,description,quantity,unit_amount_minor,line_total_minor,currency',
    [
      id(800 + n),
      c,
      id(n),
      id(issued ? 600 : 601),
      'Synthetic invoice item',
      1,
      amount,
      amount,
      'SYP',
    ],
  );
  await insert('billing_invoice_workflows', 'invoice_id,clinic_id,version', [
    id(n),
    c,
    issued ? 3 : 1,
  ]);
  const events: [string, number, number | null][] = [['draft_created', 0, null]];
  if (issued) {
    await db.query(
      "UPDATE invoices SET status='issued',issued_at='2026-01-05T09:30:00Z' WHERE id=$1",
      [id(n)],
    );
    await insert(
      'payments',
      'id,clinic_id,patient_id,invoice_id,status,method,amount_minor,currency,received_at,recorded_by_membership_id',
      [
        id(900 + n),
        c,
        id(9),
        id(n),
        'succeeded',
        'cash',
        20000,
        'SYP',
        '2026-01-05T09:31:00Z',
        id(121),
      ],
    );
    events.push(['invoice_issued', amount, null], ['payment', -20000, 900 + n]);
  }
  for (const [index, [kind, value, payment]] of events.entries()) {
    const event = id(1000 + n * 10 + index);
    await insert(
      'billing_ledger',
      'id,clinic_id,invoice_id,kind,amount_minor,currency,payment_id,receipt_reference,author_membership_id,reason,request_key,operation_hash,recorded_at',
      [
        event,
        c,
        id(n),
        kind,
        value,
        'SYP',
        payment ? id(payment) : null,
        payment ? 'SYNTHETIC-SYP-RECEIPT-1' : null,
        id(121),
        reason,
        id(2000 + n * 10 + index),
        createHash('sha256')
          .update(JSON.stringify({ synthetic: true, n, kind, value }))
          .digest('hex'),
        `2026-01-05T09:${30 + index}:00Z`,
      ],
    );
    await audit(3000 + n * 10 + index, `billing.${kind}`, event, 121, {
      patientId: id(9),
      invoiceId: id(n),
      reason,
      before: null,
      after: { synthetic: true, amountMinor: value, currency: 'SYP' },
    });
  }
}
