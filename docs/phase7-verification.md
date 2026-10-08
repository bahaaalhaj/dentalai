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

## Independent review

Reviewed commit `ae055ce` (combined Phases 5–7) against `93e26a5` on 2026-10-08,
Windows / Node 24.19.0 / npm 11.17.0. The initial working tree was clean. The historical command
record above is retained; passing it did not cover the newly discovered paths below. Review repairs
remain uncommitted, introduce no later feature phase, and do not change clinical formulas.

### Findings, ordered by severity

1. **P1, fixed — privilege restoration through invitations.** Acceptance could reactivate a
   suspended/revoked owner membership while retaining all old roles, and accepted invitations from
   disabled issuer accounts. Live issuer/recipient/session/role locks and fail-closed membership
   restoration checks now protect the transaction. Administrative invitation writes also recheck
   authorization inside their transaction, not just in route middleware.
   Source: [access.repository.ts:316](../apps/api/src/domains/access/access.repository.ts#L316).
2. **P1, fixed — same-clinic patient identity mismatch.** Tenant-only foreign keys permitted notes,
   findings, procedures, X-ray metadata and assessments to reference another patient's encounter,
   and encounters/analysis metadata to reference another patient's appointment/study. Additive
   migration `0004_review_integrity.sql` and matching ORM keys close these gaps. Clinical endpoints
   remain absent: the defect was schema integrity, not a discovered public clinical API.
   Source: [0004_review_integrity.sql:6](../packages/database/drizzle/0004_review_integrity.sql#L6).
3. **P1, deployment blocker — legacy Supabase protections are not inherited.** Archived appointment
   policies granted public full-row reads and deletion; the legacy storage policy still documents
   public X-ray reads. Local appointment provisioning is now fail-closed. The hosted project was not
   inspected or changed; backup, reconcile and verify the actual grants/policies before cutover.
   The optional freeze script is not evidence that an existing project is secured.
   Source: [legacy schema:128](../infra/supabase/database_schema.sql#L128).
4. **P1, deployment blocker mitigated — previously applied baseline was rewritten.** The completed
   commit changed migration 0000. Clean creation now succeeds, but compatibility with unknown original
   Phase 4 deployments is not established. The runner checks history hashes/timestamps, accepts only
   equivalent newline conversions, serializes migrations, and refuses silent drift. Upgrade and
   repair-failure tests retain historical data. See the rollback warning in `database-schema.md`.
   Sources: [baseline SQL:690](../packages/database/drizzle/0000_lovely_tombstone.sql#L690),
   [migration runner:40](../packages/database/src/migrations.ts#L40).
5. **P2, fixed — non-atomic security mutations/audit.** Invitation creation/revocation/acceptance,
   membership selection and explicit session revocation could commit independently of their audit.
   Domain writes now commit security/audit records atomically; injected audit failures prove rollback.
   SMTP remains an external side effect, with compensating revocation on invitation delivery failure.
   Source: [access.repository.ts:55](../apps/api/src/domains/access/access.repository.ts#L55).
6. **P2, fixed — malformed CSRF errors and concurrent token rotation.** An empty nonce caused unequal
   constant-time buffers and a 500. Strict token validation returns 403. Issuance reuses a valid cookie,
   and concurrent frontend mutations coalesce their initial token fetch.
   Sources: [csrf.ts:19](../apps/api/src/domains/auth/csrf.ts#L19),
   [api-client.ts:228](../apps/web/src/lib/api-client.ts#L228).
7. **P2, fixed — bypassed Zod transformations and invitation lifecycle errors.** Registration forwarded
   the raw name after validating its trimmed value. It now forwards parsed data. Duplicate pending
   invitations return 409 rather than 500, and expired invitations no longer block reissue permanently.
   Sources: [auth.routes.ts:39](../apps/api/src/domains/auth/auth.routes.ts#L39),
   [access.repository.ts:236](../apps/api/src/domains/access/access.repository.ts#L236).
8. **P2, fixed — missing legitimate provider availability.** Two separately anchored grids had to
   match exactly, hiding slots when provider hours started at 09:10 and clinic hours at 09:00. Window
   intersection now retains valid 09:15 slots without changing duration or DST policy.
   Source: [scheduling.repository.ts:313](../apps/api/src/domains/scheduling/scheduling.repository.ts#L313).
9. **P2, fixed — incomplete/rewritable appointment provenance.** The history audit omitted cancellation
   reasons and direct SQL could overwrite creator/terminal cancellation metadata. Migration 0004
   includes the reason and prevents rewriting that provenance; existing history is not backfilled.
   Source: [0004_review_integrity.sql:21](../packages/database/drizzle/0004_review_integrity.sql#L21).
10. **P2, fixed — unreliable and unsafe outbox error paths.** Crashes stranded processing rows, and
    arbitrary errors could expose patient/token content in logs and stored errors. Expired leases are
    reclaimed, attempt fencing rejects stale acknowledgments, and errors use fixed safe codes. Actual
    jobs remain disabled/unimplemented; delivery is at least once and requires idempotent handlers.
    Source: [outbox.worker.ts:78](../apps/api/src/workers/outbox.worker.ts#L78).
11. **P2, fixed — shutdown did not enforce its deadline or close Vite.** Setting an exit code alone
    left live sockets/watchers running. Registered Vite cleanup, bounded draining and forced failure
    exit now work; database resources stay open until in-flight HTTP handlers finish.
    Sources: [server.ts:144](../apps/api/src/server.ts#L144),
    [shutdown.ts:3](../apps/api/src/infrastructure/shutdown.ts#L3).
12. **P2, fixed — copied anesthetic test implementation hid real defects.** Test-only validation was
    absent in the actual component; blank/negative/overflow inputs could display/persist invalid output,
    and a numeric BP input could not accept its advertised systolic/diastolic format. Tests now render
    production code. Programming-level input validation and the input type are repaired; the existing
    dose multipliers, thresholds and arithmetic are unchanged and remain clinically unvalidated.
    Sources: [AnestheticCalculator.tsx:111](../apps/web/src/components/AnestheticCalculator.tsx#L111),
    [actual component tests:37](../apps/web/src/tests/anthestic.test.tsx#L37).
13. **P2, fixed — local services bound all interfaces; CI action/runtime gaps.** Compose publishing is
    now loopback-only. Checkout/setup actions use v6, checkout does not persist credentials, and a
    digest-pinned, network-isolated Gitleaks CLI replaces the license/token-dependent action wrapper.
    Remote GitHub Actions has not been executed; local passing commands are not a claim of remote CI.
    Sources: [compose.yml:12](../infra/compose.yml#L12),
    [quality.yml:90](../.github/workflows/quality.yml#L90). Action-runtime/CLI choices were checked against
    [official checkout](https://github.com/actions/checkout),
    [setup-node](https://github.com/actions/setup-node), and
    [Gitleaks documentation](https://github.com/gitleaks/gitleaks).
14. **P2, retained deployment/privacy concern — datasets and model weights.** 2,540 dataset files,
    1,272 converted dataset files, eight run outputs and the base weight remain tracked. Three weights
    total 55,470,032 bytes. No ownership/licensing/consent/de-identification determination was made, and
    no valuable artifact was deleted. Follow the existing approved-destination/checksum migration plan.
    Source: [artifact inventory](ml-artifact-migration.md#current-inventory).
    SHA-256 inventory confirmed 1,269 unique image-content hashes shared across the two dataset trees;
    labels, provenance and split equivalence still need manifest review before deduplication.
15. **P3, acknowledged — audit and old helper-only coverage.** Four moderate Drizzle/esbuild-toolchain
    dependency findings remain; the high-threshold gate is not a clean audit. Legacy doctor/record/X-ray
    helper tests are not production clinical-feature coverage and are not evidence of validation.
    Sources: [database package:39](../packages/database/package.json#L39),
    [legacy helper import](../apps/web/src/tests/doctor.test.tsx#L2).

### Acceptance assessment and behavior

The new authentication and appointment surfaces use backend-derived memberships and PostgreSQL.
Existing five-role, cross-clinic, ownership, concurrency, rollback, malformed/oversized-input and
timezone/DST tests remain in the suite. Production TypeScript strict checks are not weakened and no
new production `any` is introduced. No appointment Supabase query remains in application code.
Authentication/accounts and appointment flows are routed; legacy clinical/billing dashboards remain
deliberately unavailable, as already documented in Phase 6. This is **not** full legacy product parity
or a production cutover: accounts, historical appointments and clinical records were not imported.
Do not silently reconnect those screens to anonymous Supabase using the new session identity.

Both clinical flags still default disabled. X-ray processing always rejects without a result, including
when a demo flag is enabled; no random fallback or fake inference endpoint is added. The anesthetic
module only runs behind its explicit demo/development flag and is not for patient care. No clinical
validation, PHI-free dataset, exhaustive permission coverage or production security certification is
claimed.

### Review command record

- Baseline `npm ci`: exit 0, 513 packages added, 520 audited; four moderate findings. Existing esbuild-kit
  deprecation/npm allow-scripts warnings were recorded; no forced upgrade or install-script approval.
- Baseline `npm run verify`: exit 0; typecheck, lint, formatting, web 28/API 23 unit tests, build and
  high-threshold audit passed. The new negative tests then reproduced six auth/availability failures
  and six same-patient schema failures; the first AI-schema fixture also had a missing required field.
- Actual-component anesthetic regression tests initially reproduced nine failures previously hidden
  by the test-only copy. Valid-input arithmetic is tested for preservation, not clinical correctness.
- Final `npm run verify`: exit 0; strict typecheck, zero-warning lint, formatting, **65 unit tests**
  (web 39/API 26), production build and high-threshold audit pass. The Vite build retains two harmless
  Zod pure-annotation notices. No type/lint suppression was introduced.
- Final `npm run test:db`: exit 0; **18 database and 71 API integration tests**. Tests create/drop
  UUID-named databases using disposable PostgreSQL 17.11, fictional identities, captured/no-op mail,
  and no live Supabase or external clinical services. Intermediate fixture failures (required
  session/outbox fields and explicit SQL parameter casts) were corrected, not ignored.
- `npm run test:e2e`: exit 0; **1 real browser flow passed**. Total: **155 passing tests**, a net increase
  of 41 over the completed commit; replacing two copied anesthetic tests contributes 12 actual-component
  tests. Concurrency, revocation, rollback, worker lease/fencing/redaction and shutdown cases use
  production code rather than independent implementations of the rules.
- `npm run db:migrate --workspace @dentalai/database`: exit 0 on the isolated review database.
  Independent `node apps/api/dist/server.js --api-only` started without Vite; liveness, readiness,
  CSRF and contract endpoints returned HTTP 200. SIGINT logged graceful completion; the Windows PTY
  interruption wrapper reports exit 1, not an API shutdown error. Hung-socket deadlines are covered by
  the production shutdown helper's real HTTP unit tests.
- `npm audit --json`: exit 1 at the default threshold; exactly four moderate findings, zero high/critical.
  Affected packages are `esbuild`, `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, and `drizzle-kit`.
  No forced downgrade/upgrade is attempted. `npm run audit` exits 0 because it gates high and above.
- Gitleaks 8.30.1 full-history scan: exit 0, six commits, approximately 3.29 MB scanned, no leaks found.
  This is a text-secret scan, not a PHI/binary-model/license review.
- Gitleaks scan of modified and untracked review source: exit 0, approximately 351.83 KB, no leaks.
- `git -c core.autocrlf=false diff --check`: exit 0. Web production output contains no
  `DATABASE_URL`, `AUTH_SECRET` or `SMTP_URL` references. Remote CI remains unexecuted.
- Compose configuration validation: exit 0 with explicitly fictional local credentials; no application
  named volumes were started or removed. This review did not start MinIO; its runtime bootstrap/privacy
  must still be verified in the deployment environment.
- No npm dependency or lockfile changes. Only the obsolete copied anesthetic test helper was removed;
  it remains recoverable from Git. No patient data, historic record, dataset or weight was deleted.

Review repairs change the auth/access and scheduling repositories/middleware/client, worker/shutdown
foundation, experimental calculator validation, SQL/ORM metadata, tests, CI/local publishing and
documentation. Migration 0000 is **not** edited further; 0004 is additive. Remaining blockers are
hosted Supabase retirement/access verification, migration-history reconciliation for any older
deployment, tested backup/restore and production least-privilege/HTTPS/SMTP/retention decisions,
dataset governance, the known moderate audit findings, and unexecuted remote CI.
