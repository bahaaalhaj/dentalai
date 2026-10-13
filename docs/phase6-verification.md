# Phase 6 verification record

Historical checkpoint evidence only. Hosted dependencies mentioned below were subsequently
removed in Phase 12; current requirements/results are [SRS](srs.md) and [Phase 15](phase15-final-verification.md).

Historical phase record. Retained source paths, SDK dependencies and deployment instructions below
describe that phase only. Phase 12 intentionally retires disposable source data and legacy files;
see [the current reset report](./phase12-test-data-reset.md).
Removed files can be inspected at checkpoint tag `checkpoint/phase12-pre-test-reset-20261009`,
not reapplied as current setup or public access policies.

Run on Windows / Node 22-compatible npm workspace tooling, 2026-10-07. Existing uncommitted Phase 5
foundation changes were preserved; no commit, Supabase-user import, appointment migration, or clinical
record migration was performed. GitHub Actions was not executed remotely; its commands were exercised
locally.

## Final command results

| Command                                              | Result                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npm ci`                                             | Exit 0; added 508 packages, audited 515; 4 moderate audit findings             |
| `npm run verify` after clean install                 | Exit 0; all constituent gates below passed                                     |
| `npm run typecheck`                                  | Exit 0; strict workspace TypeScript checks passed                              |
| `npm run lint`                                       | Exit 0; zero warnings                                                          |
| `npm run format:check`                               | Exit 0                                                                         |
| `npm test`                                           | Exit 0; web 24/24, API 17/17 unit tests passed                                 |
| `npm run build`                                      | Exit 0; all shared packages, Vite production web, and independent API compiled |
| `npm run audit`                                      | Exit 0 at high threshold; 4 moderate esbuild/Drizzle-toolchain findings remain |
| `npm run test:db`                                    | Exit 0; database 8/8, API integration 28/28 passed after clean install         |
| `npm run db:migrate --workspace @dentalai/database`  | Exit 0 on disposable smoke-check database                                      |
| `npm run db:snapshot --workspace @dentalai/database` | Exit 0; reviewed current ORM metadata generated for custom migration 0002      |
| `git -c core.autocrlf=false diff --check`            | Exit 0                                                                         |

77 tests passed in total: 41 unit and 36 PostgreSQL-backed tests. Integration tests create/drop new
UUID-named databases from zero. Mail is an injected in-memory capture; no test requires real SMTP or
Supabase credentials. The temporary PostgreSQL 17.11 container was stopped/removed after validation;
only disposable fictional test data was removed, not application volumes or datasets.

Independent `node apps/api/dist/server.js --api-only` started without Vite. HTTP liveness, readiness,
and CSRF each returned 200. CSRF Set-Cookie had Secure, HttpOnly, SameSite=Strict. SIGINT produced
“Graceful shutdown completed”; the Windows PTY wrapper reports exit 1 for interruption, not an API
shutdown failure. Invalid auth configuration is rejected before opening the API, with a safe, clear
configuration error rather than credential dumps.

Build emits two non-failing Rollup notices about pure annotations in Zod dependency comments. Install
warns that old esbuild-kit packages are deprecated and reports pending npm allow-scripts entries for
esbuild; no unreviewed install-script approval or forced dependency upgrade was applied. The builds
and tests passed nevertheless. `npm audit --omit=dev --audit-level=low` also reports the same four
workspace toolchain findings; it is not represented as a clean production audit.

## Added security coverage

- Public role/identity/clinic injection and minimum password validation.
- Positive access for all five roles; cross-clinic patient identities, invitation visibility/revocation,
  membership selection, and other-user session revocation; same-clinic other-patient denial.
- Administrative invitations, email binding, single use, ownership escalation denial, and non-admin denial.
- Required verification and resend, CSRF rejection, opaque secure cookies, incoming-session rotation,
  logout, listed-session revocation, expiry, reset replay, password replacement, and reset-all-sessions.
- Account brute-force locking and IP endpoint rate limiting despite spoofed forwarding headers.
- Live membership revocation, composite session-context FK, append-only token-free audit, safe
  configuration messages, frontend credentialed CSRF transport, restoration, route expiry, and outages.

Initial new-test failures were test-fixture SQL parameter type inference and missing jsdom selection;
both were corrected. One intermediate verification run stopped on formatting, also corrected. A
Windows smoke-command attempt used a newer .NET random-byte overload unavailable in Windows
PowerShell 5.1; the command was corrected without changing cryptographic implementation. No remaining
test/build failure is being classified as pre-existing or ignored.

## Dependencies and changed areas

Added exact API dependencies Better Auth 1.7.7, `@better-auth/drizzle-adapter` 1.7.7, Nodemailer
10.0.15, and an explicit Drizzle ORM 0.45.3 dependency; added Nodemailer types 7.0.11. Lockfile is
updated and root `npm ci` succeeds. Supabase is retained. No forced upgrade was executed.

Phase 6 changes cover:

- `apps/api/src/domains/auth/` and `domains/access/`: maintained auth adapter, SMTP transport, CSRF,
  invitation/tenant repositories and routes, and initial-owner operator command.
- API `app.ts`, `server.ts`, environment validation, and safe error/logging integration.
- `apps/web/src/App.tsx`, `AuthPage.tsx`, new `AccountPage.tsx`, API client, legacy dashboard auth calls,
  disabled Supabase session persistence, auth test helper, and Vite API proxy.
- `packages/contracts/src/auth.ts` plus API contract generation and exports.
- `packages/database/src/schema/{core,auth,index}.ts`, reviewed `0002_backend_auth.sql`, journal and
  `0002_snapshot.json`, metadata-generation CLI, and migration-count assertion.
- API authentication integration/unit tests and frontend client/route-guard tests.
- Root/API/database scripts and dependency manifests/lockfile, `.env.example`, README, architecture,
  schema/migration notes, and authentication/verification documents.

## Remaining deployment decisions

Configure SMTP, random AUTH_SECRET, HTTPS/trusted-proxy policy, and first-owner provisioning. Define
patient linkage, existing Supabase account transition, MFA/owner recovery, credential rotation,
audit retention, cleanup of expired auth records/counters, least-privilege database deployment, and
defense-in-depth RLS before production clinical rollout. Four moderate toolchain findings remain.

Old clinical/appointment dashboards are deliberately not routed with new cookies; their code is
retained for later feature migration. New sessions expose only the themed account/access dashboard.
Clinical safety flags remain disabled by default, and nothing here constitutes clinical validation.
