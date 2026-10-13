import { createHash } from 'node:crypto';
import { type PoolClient } from 'pg';
import {
  developmentId,
  developmentClinicId,
  reason,
  type Insert,
  type Exists,
  type Audit,
} from './seed-identity.js';
export async function seedClinical(_db: PoolClient, insert: Insert, exists: Exists, audit: Audit) {
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
export async function seedInvoice(
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
