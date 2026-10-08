-- Development-only seed. All identities and contact details below are fictional.
-- The reserved .invalid domain ensures no email can reach a real person.

BEGIN;

INSERT INTO clinics (id, legal_name, display_name, slug, default_timezone, default_currency)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  'Harbor Demo Dental LLC',
  'Harbor Demo Dental',
  'harbor-demo-dental',
  'Etc/UTC',
  'USD'
) ON CONFLICT DO NOTHING;

INSERT INTO clinic_settings (clinic_id, appointment_lead_minutes, appointment_horizon_days)
VALUES ('10000000-0000-4000-8000-000000000001', 30, 365)
ON CONFLICT DO NOTHING;

INSERT INTO locations (id, clinic_id, name, timezone, city, country_code)
VALUES (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  'Fictional Harbor Clinic',
  'Etc/UTC',
  'Example City',
  'US'
) ON CONFLICT DO NOTHING;

INSERT INTO operatories (id, clinic_id, location_id, name)
VALUES (
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'Demo Operatory 1'
) ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, display_name, email_verified_at)
VALUES (
  '10000000-0000-4000-8000-000000000004',
  'avery.clinician@example.invalid',
  'Dr. Avery Example',
  now()
) ON CONFLICT DO NOTHING;

INSERT INTO roles (id, clinic_id, key, name, permissions)
VALUES (
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000001',
  'demo-provider',
  'Demo Provider',
  '["appointments:read", "patients:read"]'::jsonb
) ON CONFLICT DO NOTHING;

INSERT INTO memberships (id, clinic_id, user_id, status, joined_at)
VALUES (
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004',
  'active',
  now()
) ON CONFLICT DO NOTHING;

INSERT INTO membership_roles (clinic_id, membership_id, role_id)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000005'
) ON CONFLICT DO NOTHING;

INSERT INTO staff (id, clinic_id, membership_id, kind, employee_number, title)
VALUES (
  '10000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000006',
  'provider',
  'DEMO-001',
  'Fictional Dentist'
) ON CONFLICT DO NOTHING;

INSERT INTO providers (id, clinic_id, staff_id, provider_type)
VALUES (
  '10000000-0000-4000-8000-000000000008',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000007',
  'dentist'
) ON CONFLICT DO NOTHING;

INSERT INTO patients (
  id, clinic_id, medical_record_number, given_name, family_name, preferred_name, date_of_birth, email
) VALUES
  (
    '10000000-0000-4000-8000-000000000009',
    '10000000-0000-4000-8000-000000000001',
    'DEMO-0001',
    'Mina',
    'Example',
    'Mina',
    DATE '1990-04-15',
    'mina.patient@example.invalid'
  ),
  (
    '10000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000001',
    'DEMO-0002',
    'Samir',
    'Sample',
    NULL,
    DATE '1984-09-03',
    'samir.patient@example.invalid'
  )
ON CONFLICT DO NOTHING;

INSERT INTO working_hours (
  id, clinic_id, location_id, provider_id, weekday, opens_at_local, closes_at_local
) VALUES (
  '10000000-0000-4000-8000-000000000011',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000008',
  1,
  TIME '09:00',
  TIME '17:00'
) ON CONFLICT DO NOTHING;

INSERT INTO appointment_types (
  id, clinic_id, name, code, default_duration_minutes, color
) VALUES (
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000001',
  'Demonstration examination',
  'DEMO-EXAM',
  30,
  '#2563EB'
) ON CONFLICT DO NOTHING;

INSERT INTO services (id, clinic_id, code, name, description)
VALUES (
  '10000000-0000-4000-8000-000000000013',
  '10000000-0000-4000-8000-000000000001',
  'DEMO-SVC',
  'Demonstration service',
  'Non-clinical fictional seed service'
) ON CONFLICT DO NOTHING;

INSERT INTO price_lists (id, clinic_id, name, currency, effective_from)
VALUES (
  '10000000-0000-4000-8000-000000000014',
  '10000000-0000-4000-8000-000000000001',
  'Demo price list',
  'USD',
  TIMESTAMPTZ '2026-01-01 00:00:00+00'
) ON CONFLICT DO NOTHING;

INSERT INTO price_list_items (id, clinic_id, price_list_id, service_id, amount_minor, currency)
VALUES (
  '10000000-0000-4000-8000-000000000015',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000014',
  '10000000-0000-4000-8000-000000000013',
  5000,
  'USD'
) ON CONFLICT DO NOTHING;

INSERT INTO appointments (
  id,
  clinic_id,
  location_id,
  operatory_id,
  patient_id,
  provider_id,
  appointment_type_id,
  status,
  starts_at,
  ends_at,
  timezone,
  reason,
  created_by_membership_id
) SELECT
  '10000000-0000-4000-8000-000000000016',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000009',
  '10000000-0000-4000-8000-000000000008',
  '10000000-0000-4000-8000-000000000012',
  'scheduled',
  TIMESTAMPTZ '2030-01-07 09:00:00+00',
  TIMESTAMPTZ '2030-01-07 09:30:00+00',
  'Etc/UTC',
  'Fictional seed appointment',
  '10000000-0000-4000-8000-000000000006'
WHERE NOT EXISTS (
  SELECT 1 FROM appointments WHERE id = '10000000-0000-4000-8000-000000000016'
);

COMMIT;
