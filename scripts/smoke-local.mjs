// Operator-only smoke check of generated synthetic development accounts. Never prints credentials.
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { AuthIdentitySchema } from '@dentalai/contracts';

loadEnvFile('.env');
const origin = process.env.APP_ORIGIN;
if (
  process.env.NODE_ENV !== 'development' ||
  !origin ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)
)
  throw new Error('Smoke checks require an explicitly local development instance.');
const credentials = JSON.parse(await readFile('.local/development-credentials.json', 'utf8'));
if (credentials.localOnly !== true || typeof credentials.password !== 'string')
  throw new Error('Generated local-only credentials required.');
const tenant = '10000000-0000-4000-8000-000000000001';
const patient = '10000000-0000-4000-8000-000000000009';
for (const [email, role] of [
  ['owner@example.invalid', 'clinic_owner'],
  ['admin@example.invalid', 'clinic_admin'],
  ['dentist@example.invalid', 'dentist'],
  ['dentist2@example.invalid', 'dentist'],
  ['receptionist@example.invalid', 'receptionist'],
  ['patient@example.invalid', 'patient'],
]) {
  const cookies = new Map();
  async function call(path, body, csrf) {
    const response = await fetch(`${origin}${path}`, {
      method: body ? 'POST' : 'GET',
      redirect: 'manual',
      headers: {
        cookie: [...cookies.values()].join('; '),
        ...(body ? { origin, 'content-type': 'application/json', 'x-csrf-token': csrf } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const value = cookie.split(';')[0];
      cookies.set(value.split('=')[0], value);
    }
    if (!response.ok)
      throw new Error(`Local smoke endpoint ${path} failed with status ${response.status}.`);
    return response.json();
  }
  const csrf = await call('/api/v1/access/csrf');
  await call('/api/v1/auth/sign-in/email', { email, password: credentials.password }, csrf.token);
  const identity = AuthIdentitySchema.parse(await call('/api/v1/access/me'));
  if (
    identity.activeMembership?.clinicId !== tenant ||
    !identity.activeMembership.roles.includes(role)
  )
    throw new Error('Local seed role/tenant assertion failed.');
  await call('/api/v1/appointments?view=upcoming');
  await call('/api/v1/appointments?view=history');
  await call('/api/v1/admin/notification-preferences');
  if (role === 'clinic_owner' || role === 'clinic_admin') {
    const administration = await call('/api/v1/admin/overview');
    if (
      administration.configuration.clinicId !== tenant ||
      administration.configuration.currency !== 'SYP' ||
      administration.subscription.provider !== 'administrative-mock'
    )
      throw new Error('Local clinic administration tenant/currency/provider assertion failed.');
    await call('/api/v1/admin/plans');
    await call('/api/v1/admin/notifications');
    if (role === 'clinic_owner') await call('/api/v1/admin/audit');
  }
  if (role === 'patient') {
    await call('/api/v1/clinical/portal');
    await call('/api/v1/billing/portal');
  } else {
    await call('/api/v1/billing/catalog');
    if (role === 'dentist') {
      await call('/api/v1/clinical/patients');
      await call(`/api/v1/clinical/patients/${patient}`);
      await call(`/api/v1/imaging/patients/${patient}`);
      const assessments = await call(`/api/v1/anesthesia/patients/${patient}`);
      if (
        assessments.some(
          (record) => record.output.maximumMg !== null || record.output.proposedMg !== null,
        )
      )
        throw new Error('Clinical safety gate failed.');
    }
  }
  const logoutCsrf = await call('/api/v1/access/csrf');
  await call('/api/v1/auth/sign-out', {}, logoutCsrf.token);
  console.log(`Local API smoke passed: ${role}.`);
}
console.log(
  'All synthetic local roles and implemented domain read flows passed. No clinical validation claimed.',
);
