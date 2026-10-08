# Phase 7 verification record

Implemented and tested locally on Windows, Node 24.19.0 / npm 11.17.0, 2026-10-08. CI remains configured
for Node 22; that remote run was not executed here. Existing uncommitted Phase 5/6 changes were
preserved. Phase 1 clinical safety gates were inspected and remain disabled by default; the prior
Phase 6 verification record was inspected. No later phase, clinical-record migration, production
database mutation, Supabase-user import, or valuable dataset/model cleanup was performed. GitHub
Actions was not run remotely; the corresponding verification commands were exercised locally.

## Commands and results

| Command                                                                                  | Result                                                                                               |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Baseline `npm test`, before Phase 7 implementation                                       | Exit 0; web 24/24 and API 17/17 unit tests                                                           |
| `npm ci`, after dependency changes                                                       | Exit 0; added 513 packages, audited 520; four moderate findings                                      |
| `npm run verify`, after clean install and legacy appointment removal                     | Exit 0; all constituent typecheck/lint/format/unit/build/audit gates passed                          |
| `npm run typecheck`                                                                      | Exit 0; strict workspace checks, including separately typed browser E2E/server fixture               |
| `npm run lint`                                                                           | Exit 0; zero warnings                                                                                |
| `npm run format:check`                                                                   | Exit 0                                                                                               |
| `npm test`                                                                               | Exit 0; web 28/28, API 23/23 unit tests                                                              |
| `npm run build`                                                                          | Exit 0; shared packages, production web, independent API compiled                                    |
| `npm run audit` (`npm audit --audit-level=high`)                                         | Exit 0; zero high/critical, four moderate toolchain findings remain                                  |
| `npm audit --json`                                                                       | Exit 1 at its default threshold; confirms four moderate findings, not a clean audit                  |
| `npm run db:snapshot --workspace @dentalai/database`                                     | Exit 0; generated/reviewed `0003_snapshot.json` for the custom migration                             |
| `npm run test:db`, final full rerun                                                      | Exit 0; database 8/8, API integration 54/54 (28 authentication, 26 scheduling)                       |
| `npx playwright install --no-shell chromium`                                             | Exit 0; pinned Chromium installation supports the configured Chromium channel                        |
| `npm run test:e2e`, after legacy removal                                                 | Exit 0; 1/1 real browser patient-book/staff-confirm/patient-cancel/history flow                      |
| `npm run typecheck --workspace @dentalai/web`, after final availability-notification fix | Exit 0                                                                                               |
| `npm run lint`, after final availability-notification fix                                | Exit 0                                                                                               |
| `npm run build --workspace @dentalai/web`, after that fix                                | Exit 0                                                                                               |
| `npm run test --workspace @dentalai/web`, after that fix                                 | Exit 0; 28/28                                                                                        |
| `npm run test:e2e`, final notification/closure rerun                                     | Exit 0; 1/1, including closed-date notification, then real booking/confirmation/cancellation/history |
| `git -c core.autocrlf=false diff --check`                                                | Exit 0                                                                                               |

114 tests pass in total: 51 unit, 62 PostgreSQL-backed, and one real browser E2E. Tests create new
UUID-named PostgreSQL databases from zero, use fictional patients and locally provisioned verified
accounts, and drop their databases afterward. SMTP is an injected no-op; no tests require real
Supabase credentials or external services. Browser tests make real API/auth requests, not mocked
appointment responses. Only the disposable PostgreSQL 17.11 validation container is used.
After the final tests, zero generated test databases remained. The identity-checked disposable
container was stopped and automatically removed; no application volumes, real patient data, datasets
or model artifacts were removed.

## Coverage and debugging

New scheduling tests cover:

- Five-role and clinic/resource visibility, anonymous access denial, patient-only ownership and
  explicit portal linkage, dentist-provider scope, and positive staff booking for all four staff roles.
- Strict patient/staff bodies rejecting browser-selected authority fields; expired, consumed,
  tampered, other-user and wrong-clinic resource/offer access.
- Concurrent HTTP bookings for identical resources/time: exactly one success and one 409, one row.
- Concurrent direct PostgreSQL bookings without application locks/checks: one success, one `23P01`.
- Concurrent direct closure/appointment inserts: exactly one succeeds.
- PostgreSQL deletion/transition/terminal-timezone guards, composite tenant FKs, rollback of failed
  bookings, unconsumed offers on failure, half-open interval boundaries, and schedule blocks.
- Book-confirm-reschedule-cancel with retained identity/history and actor-correct audit entries;
  revision conflicts, no-show/completion timing, receptionist completion denial, and historical views.
- Changed working hours, provider hours, closures, clinic-local dates, 23/25-hour DST days, nonexistent/
  ambiguous times and offset-crossing duration rejection.
- Typed credentialed/CSRF frontend calls, minimal patient booking/reschedule bodies, cancellation as a
  transition rather than DELETE, safe DTOs, collisions/malformed responses and expired-session guards.
- Real themed patient booking and dentist calendar confirmation, closed-date live notification,
  dialog labeling/Escape dismissal, patient refresh/cancellation, and retained audit timeline.

The three legacy mocked-Supabase appointment tests and their unsafe helper were replaced by seven
typed API-client tests plus the database/browser coverage above. Existing auth, clinical-safety,
record and billing-related coverage remains. A source search finds no Supabase appointment queries,
appointment realtime subscriptions, hardcoded `TIME_SLOTS`, old `confirmation_status`, or ambiguous
date-only appointment parsing in `apps/web/src`.

Intermediate tests caught PostgreSQL parameter type inference in the status UPDATE: explicit enum/
UUID/text casts fixed the staff-confirmation error, and all transition tests pass. Fixture syntax/
typing and formatting issues were corrected rather than ignored. Adding E2E strict typing required
including the server Request augmentation in a separate Node-only TypeScript configuration.
An initial unrestricted browser install downloaded full Chromium; its unnecessary headless-shell
download was deliberately stopped, then the documented `--no-shell` install completed successfully.
One intermediate explicit Prettier invocation incorrectly included ignore files without a parser;
the final repository formatting check passes. No remaining test/build failure is waived.

Build retains the two non-failing Zod dependency pure-annotation notices. Scheduling is lazy-loaded;
the final largest web chunk is approximately 424 kB minified, below Vite's 500 kB warning threshold.
Install still warns about deprecated esbuild-kit packages and pending npm allow-scripts entries;
no forced dependency upgrade or unreviewed install-script approval was applied.

## Dependency changes

- Added exact `@js-temporal/polyfill` 0.5.1 to `@dentalai/domain`; transitive `jsbi` 4.3.2.
- Added exact development dependency `@playwright/test` 1.64.0 to the web workspace.
- Added internal `@dentalai/domain` 0.0.0 dependency to the API workspace.
- Updated the root lockfile; a root clean install succeeds. Supabase remains installed for other domains.

The unchanged four moderate findings are `esbuild` (through `@esbuild-kit/core-utils`),
`@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, and `drizzle-kit`.
The underlying advisory is [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
The offered forced fix is a breaking Drizzle Kit downgrade, so it was not applied in this phase.

## Changed Phase 7 areas

- API scheduling repository/routes, application mounting/security auditing, API domain dependency,
  scheduling unit/integration tests and isolated shared fixture.
- Shared appointment contracts/OpenAPI registration/exports and domain transition/Temporal utilities.
- Additive reviewed `packages/database/drizzle/0003_backend_scheduling.sql`, journal/snapshot,
  scheduling schema/revision/actor/runtime tables and migration-count assertion.
- Web `AppointmentsPage.tsx`, account navigation, route guard/lazy loading, typed API client;
  legacy patient/doctor appointment removal and removal of the Supabase appointment type.
- Removed `apps/web/src/test_utils/appointment-utils.ts` and `src/tests/appo.test.tsx`; added
  `src/tests/api-appointments.test.ts`, Playwright configuration/E2E and separate strict E2E tsconfig.
- Shared native `ActionDialog` and UI exports; root/web scripts, dependencies/lockfile, test discovery,
  generated-report ignores and GitHub Actions browser gate.
- README, architecture/schema/legacy-mapping notes, `docs/appointments.md`, this record, and optional
  `infra/supabase/phase7-appointment-freeze.sql` operator cutover script.

Legacy clinical/billing Supabase code remains unrouted with backend sessions. The legacy patient
delete/cascade action is disabled because it could destroy retained Supabase appointment history.
No historical table or data was deleted. Other pre-existing dirty files belong to earlier work and
were not reset or claimed as new Phase 7 implementation.

## Remaining deployment decisions

There is no unresolved local test/build blocker. Production use still requires operator provisioning
of locations/timezones, invited dentists, chairs/types/hours, verified accounts and explicit patient
entity/portal membership linkage. Existing Supabase accounts and historical appointments are not
automatically imported: approve/export/reconcile their mapping before any production data cutover.

Retire the legacy Supabase public/full-row appointment policies and grants after reconciliation;
the optional freeze script is supplied but was not run against any Supabase project. Old Supabase
data does not inherit the new API's protections. Define bounded expired-offer cleanup, production
least-privilege DB/RLS/HTTPS/SMTP operations, retention and audit review. Existing Phase 6 security
deployment decisions still apply. Overnight hours, recurrence, multi-clinic shared-provider/resource
calendars, patient-directory migration and appointment email reminders are not included.

Clinical-record screens and experimental X-ray/anesthetic modules remain frozen. No clinical
validation or patient-care suitability is claimed. Implementation stops at Phase 7.
