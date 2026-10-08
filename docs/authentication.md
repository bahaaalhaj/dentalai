# Phase 6: backend-owned authentication and clinic access

Only authentication, clinic selection, invitations, session management, and explicitly permitted
patient **identity metadata** are implemented. Appointment and clinical-record features are not migrated.
The X-ray/anesthetic safety freeze is unchanged. Supabase remains installed for later feature work;
its browser session persistence, automatic refresh, and URL-session detection are disabled.

## Trust boundary and roles

Better Auth 1.7.7 owns password hashing (its maintained scrypt implementation), verification/reset
tokens, and opaque database sessions through the Drizzle adapter. No JWT/session token is returned
in our JSON contracts or persisted by frontend code. Secure, HttpOnly, SameSite=Lax cookies are
required in every environment. Cookie caching is disabled; every protected request loads the session,
enabled user, active clinic, active membership, and role links from PostgreSQL.

Public registration has a strict allowlist: name, email, password, and optional phone. It cannot assign
a membership, role, clinic, or patient clinical entity. All accounts have an unprivileged global
`accountRole: patient`; actual privileges are clinic-bound and are not inferred from that label.
Staff register/verify this same unprivileged account, then accept an administrator-issued invitation.

| Resource/action                                    | owner | admin | dentist | receptionist | patient            |
| -------------------------------------------------- | ----- | ----- | ------- | ------------ | ------------------ |
| Own profile and sessions; own membership selection | yes   | yes   | yes     | yes          | yes                |
| Selected clinic identity                           | yes   | yes   | yes     | yes          | yes                |
| Create/list/revoke clinic staff invitations        | yes   | yes   | no      | no           | no                 |
| Patient identity metadata within selected clinic   | yes   | yes   | yes     | yes          | linked record only |
| Appointments or clinical records through this API  | no    | no    | no      | no           | no                 |

Clinic selection accepts a membership identifier **only as a selector**. The server proves that it
belongs to the authenticated user and an active clinic; browser clinic/user/role fields are rejected.
Patient identity lookup also requires the selected clinic and, for a patient-only membership, an
explicit `patients.portal_user_id` link. No email-based auto-linking or public linking endpoint exists.
Patient metadata includes name and medical-record number, not diagnoses, notes, or files. A future
clinical migration must define its own narrower permissions; these metadata permissions do not grant
clinical access. Database session context FKs additionally bind clinic, membership, and user together.

## Staff and first-owner provisioning

Owners/admins can invite `clinic_admin`, `dentist`, or `receptionist` in their selected clinic. No
browser endpoint grants ownership. Invitations expire after 48 hours, store SHA-256 token hashes,
bind to the recipient's verified email, and are consumed under a transaction/row lock. Acceptance
rechecks the issuer's active administrative membership, creates the staff/provider relationship,
selects the clinic, and writes audit history. Failed delivery revokes the invitation. Revoked,
expired, wrong-email, replayed, or cross-clinic invitations do not grant access.

An operator with trusted server/database access bootstraps the **first** owner of an existing clinic:

```bash
npm run auth:bootstrap-owner -- <clinic-uuid> <verified-email>
```

First register and verify the account, apply migrations, and provision the clinic through trusted
operator tooling. This command serializes owner bootstrap, seeds the fixed role vocabulary, refuses
clinics with an existing owner, and records the grant in `audit_events`. It is not a public endpoint
and does not create a password or bypass email verification. Clinic creation, patient linkage,
ownership transfer, and a role-management UI remain deliberate later operator workflows.

## CSRF, session lifecycle, and abuse protection

`GET /api/v1/access/csrf` issues a short-lived signed double-submit token plus a Secure, HttpOnly,
SameSite=Strict `__Host-` cookie. Every unsafe auth/access request must present the corresponding
`X-CSRF-Token` and exact configured Origin. Better Auth origin checks remain enabled. Verification
links are signed, expiring tokens and use a fixed same-origin callback; arbitrary browser redirect
URLs are never accepted. Password-reset/invitation links use URL fragments to avoid HTTP query logs.

Verification is required before login. Reset tokens are hashed at rest, single-use, and expiring.
Reset revokes every prior session. Successful login issues a new opaque session and revokes any
incoming session; logout and explicit revocation delete the server session. Expired/revoked sessions
return 401; disabled users and revoked memberships cannot obtain clinic access. Frontend restoration
uses `/access/me` and has no role fallback; 401 clears protected routes, while outages display retry.

The API has an IP limiter, Better Auth has database-backed endpoint limits (login 10/minute,
registration 5/minute, reset/verification 3/minute), and HMAC-keyed account counters block login for
15 minutes after five failures within a 15-minute window. Auth IP headers are supplied by the server
from Express's effective client IP, overriding browser-supplied values. Keep `TRUST_PROXY=false`
unless exactly one trusted reverse proxy prevents direct API access and replaces forwarding headers.
Multi-proxy deployments need an explicit trust policy, not a boolean change alone.

Global append-only `security_events` record registration, verification, session lifecycle, resets,
authentication failures, and request/authorization denials. Clinic events additionally use append-only
`audit_events`; invitation acceptance is audited in its grant transaction. Request IDs support
correlation. Neither log contains submitted passwords, cookies, reset/invitation tokens, or SQL
parameter dumps. The auth library's generic JSON responses are replaced with our safe Zod contracts.

## Local and production configuration

Set server-only `DATABASE_URL`, a randomly generated `AUTH_SECRET` of at least 32 characters,
`APP_ORIGIN` (one exact HTTP(S) origin, no trailing slash/path), `SMTP_URL` using smtp/smtps, and
`MAIL_FROM`. Never prefix these with `VITE_`. Generate a secret locally, for example:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Use a local SMTP capture service or an explicitly configured SMTP provider; no mail credentials or
no-op production mail sender are supplied. Migrate before starting. `npm run dev` hosts web/API on
one origin; `npm run dev:api` starts the API independently. Separate Vite uses a `/api` proxy to port
3000 and requires `APP_ORIGIN` to equal the browser's Vite origin. Auth pages do not require Supabase
credentials; retained legacy feature modules still validate their public Supabase configuration.

Production requires HTTPS for APP_ORIGIN and TLS at a trusted edge. Secure cookies are never relaxed.
Browsers generally permit Secure cookies on localhost; use local HTTPS for non-localhost hosts or
environments that reject localhost exceptions. Configure HTTPS/tunnel/proxy and SMTP outside the
repository; do not treat an HTTP deployment with missing cookies as successful authentication.

## Storage and migration caveats

`0002_backend_auth.sql` creates `auth_accounts`, `auth_sessions`, `auth_verifications`,
`auth_rate_limits`, `login_attempts`, and append-only `security_events`. Existing `sessions` and
`users.password_hash` remain reserved legacy columns/tables; the auth provider never authenticates
with them. There is no automatic Supabase-user/password/session import. Existing users need a
separately reviewed account transition before product rollout. No real users or clinical data are
migrated in this phase.

The reviewed custom migration includes `0002_snapshot.json` so later ORM generation starts from the
current schema. `npm run db:snapshot --workspace @dentalai/database` generates non-overwriting ORM
metadata after a custom reviewed migration; it does not create or apply SQL. SQL-only triggers remain
in the reviewed migrations, not ORM snapshots.

Better Auth stores opaque session tokens in its server-only table; database/backups must therefore
be access-restricted and encrypted at rest. OAuth fields are library-compatible but OAuth endpoints
are not exposed. Global security-event identity is intentionally not tenant-owned (login can precede
membership); optional clinic context is included when known. Audit retention, expired-session/rate
counter cleanup, SMTP delivery policy, credential/secret rotation, owner recovery, MFA, and compliance
review need operational decisions before a production clinical deployment. Password login alone is
not a claim of clinical readiness or completed security certification.

## Verification

`npm run verify` checks types, lint, formatting, unit tests, build, and audit. With a disposable
PostgreSQL URL, `npm run test:db` creates/drops UUID-named databases and tests clean migrations and
real authentication. SMTP is injected into an in-memory test capture; no live email/Supabase calls
are required. Tests cover each role, every protected resource family, role/identity injection,
CSRF, verification, email-bound invitations, fixation, expiry, revocation, logout, reset replay,
brute force, spoofed-IP rate-limit bypass, membership revocation, database session context, and audit.

The themed account dashboard replaces entry into the old clinical dashboards during this boundary
transition. Their code and Supabase feature queries are retained but not routed or bridged to new
sessions. Migrating those queries or forwarding a new session identity into anonymous Supabase
access would exceed Phase 6 and create an unsafe second authorization boundary.

References: [Better Auth security](https://better-auth.com/docs/reference/security),
[email/password](https://better-auth.com/docs/authentication/email-password),
[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle),
[rate limiting](https://better-auth.com/docs/concepts/rate-limit).
