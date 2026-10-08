# Phase 12 — intentional test-data reset

## Authorization and checkpoint

The operator confirmed that the Supabase source contained disposable development/test data only,
and explicitly waived preserving/importing legacy rows. This is an operator attestation, not an
independently counted inventory. Earlier read-only connection attempts failed with DNS `ENOTFOUND`;
source row/file counts, checksums and a backup could not be obtained. Counts are **unknown, not zero**.
No passwords/authentication secrets were recovered. No further source connection or remote mutation
was attempted under the approved reset path. No legacy data was migrated or currency converted.

Initial worktree was clean. Annotated tag `checkpoint/phase12-pre-test-reset-20261009` retains
commit `6c06301` and all pre-removal code/SQL. No historical datasets/model weights or self-hosted
clinical records were deleted. Hosted project retirement was not performed or verified.

## Replacement architecture and seeding

The only remaining `profiles` queries were in unreachable `DoctorDashboard.tsx` and
`PatientDashboard.tsx`; neither was imported by current routes. Only the old doctor dashboard used
`BillingSection`. Routed replacements use `/api/v1/access/me`, `/api/v1/clinical/patients` and
`/api/v1/billing`. Real API role login, clinical directory, patient projection and billing checks
passed before retiring obsolete modules. No fallback anonymous database access is retained.

The new API-side seed uses one transaction/advisory lock, deterministic UUIDs and maintained
Better Auth hashing. It rejects production, remote/maintenance databases, identity conflicts and
an incompatible default tenant/currency. Reruns preserve all existing rows and password hashes.
Generated credentials are private, ignored, local-only, never printed or deployed. Synthetic users
are verified fixtures; public registration's role/verification rules are unchanged.

Tenant: `10000000-0000-4000-8000-000000000001`; timezone `Etc/UTC`. Every tenant-owned seed row
uses it; global identities link through memberships. Financial fixtures are explicitly **SYP**:
cavity 50000, filling 150000, extracted 100000, root_canal 450000, crown 800000, implant 1200000.
Numbers are stored 1:1 as integer minor units, with no exchange-rate conversion. The older USD SQL
fixture remains for historical upgrade/constraint tests only, not application seeding.

| Seed entity                                                  | Count before user activity |
| ------------------------------------------------------------ | -------------------------: |
| Clinics / locations / chairs                                 |                  1 / 1 / 1 |
| Users / credential accounts / memberships                    |                  6 / 6 / 6 |
| Roles / staff / providers                                    |                  5 / 3 / 2 |
| Patients                                                     |                          2 |
| Working hours / appointment types                            |                     10 / 1 |
| Appointments / status history                                |                      3 / 3 |
| Services / price lists / price items                         |                  6 / 1 / 6 |
| Encounters / clinical revisions                              |                      1 / 4 |
| Notes / findings / procedures / treatment plans / plan items |          1 / 1 / 1 / 1 / 1 |
| Invoices / items / ledger events / payments                  |              2 / 2 / 4 / 1 |
| X-ray studies / files / AI runs                              |                  1 / 0 / 0 |
| Blocked draft anesthesia assessments                         |                          1 |

Clinical records remain drafts until clinician approval. Issued invoice 50000, payment 20000 and
remaining ledger balance 30000 are SYP; the 150000 invoice stays draft. X-ray metadata is explicitly
synthetic with no invented acquisition time/image/findings. Anesthesia has no dose output.

Storage explicitly selects existing private S3 or actual private filesystem storage; there is no
fallback from missing S3. Tenant-scoped UUID keys, immutable files and authorized API streaming
retain the existing upload validation/checksum pipeline. No public bucket is recreated. Missing
inference stores a safe failed run with null result, never findings. Previous versions remain intact.
Offline development uses local PostgreSQL, private files and a development-only private mailbox
containing real verification/reset messages. Production prohibits filesystem mail and requires SMTP.
The same fonts and landing-animation WASM engine are bundled locally. Initial dependency/image/browser installation needs a network
or cache; installed application runtime does not.

## Reset and rollback

Clean-clone commands: `npm ci`, `npm run dev:configure`, `npm run infra:up:local`,
`npm run dev:seed`, `npm run dev`. Repeat `dev:seed` for idempotent add-only reseeding.
For an actual reset, retain the old database/volume and create a new dedicated local database,
change `DATABASE_URL`, migrate/reseed and select a new private object directory. Never silently
relabel USD data or drop existing records. Concrete commands and backup/restore guidance are in
[deployment/backup](deployment-and-backup.md). Configuration generation refuses existing files.

The checkpoint permits code recovery in a separate checkout, not recovery of unavailable cloud
data. Do not deploy it to re-enable old public policies, legacy auth or browser simulation. No
destructive down migration is added. Existing deployments require a consistent PostgreSQL/private
object backup and restore test before changing code/schema.

## Verification and removal manifest

Removed files (all recoverable from the checkpoint):

- `apps/web/src/DoctorDashboard.tsx`, `PatientDashboard.tsx`, `components/BillingSection.tsx`:
  unreachable legacy dashboards/wrapper, including both remaining `profiles` queries.
- `apps/web/src/lib/supabase.ts`, `supabase-config.ts`, `tests/supabase-config.test.ts`:
  client, old DTOs, configuration validator and three now-obsolete SDK configuration tests.
- `infra/supabase/database_schema.sql`, `phase7-appointment-freeze.sql`: legacy setup and optional
  policy script, never run during this reset. The removed schema included `handle_new_user`,
  `is_doctor`, legacy auth triggers/RLS policies, `xrays` public bucket, storage public-read/upload
  policies and six `supabase_realtime` table publications. This removes provisioning code, not remote policies.
- `docs/migration/supabase-to-postgresql.md`: superseded, unexecuted live-mapping/setup proposal.
- `packages/database/src/cli/seed.ts` and its `db:seed` script: retired old USD fixture entry point.
  Reviewed upgrade/constraint fixture SQL remains explicitly historical; use root `dev:seed` for SYP.

Removed SDK packages: `@supabase/supabase-js` 2.117.2 and transitive `@supabase/auth-js`,
`functions-js`, `phoenix`, `postgrest-js`, `realtime-js`, `storage-js`, plus `iceberg-js`.
Added pinned `@fontsource/inter` / `@fontsource/space-grotesk` 5.3.0 for local fonts.
Declared already-installed `@lottiefiles/dotlottie-web` 0.70.0 directly to bundle its WASM asset;
no version upgrade or forced dependency change was used.

Removed `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` configuration, browser typings and Vite substitutions. The ignored local
environment's obsolete values were discarded without printing/retention; unrelated comments were
preserved privately, then fresh local configuration was generated. `.env.example` contains names only.
Removed the global obsolete auth/query mock in web `test/setup.ts`; network blocking remains.
Existing API-based auth helpers and permanently-disabled browser analyzer tests are retained.

Repository searches cover all requested terms, tracked files (including normally ignored tracked
content), untracked source/docs, manifests, lockfile, actual environment files and the built web
bundle. No application/configuration/SQL/SDK occurrence remains. Remaining source-project references
are intentional historical phase reports/path maps/ADR context, the explicitly historical Phase 8
verification section and this reset/removal report. Current README/architecture mention deliberate
refresh/no realtime fallback only. No actual realtime channel, `createClient`, `storage.from` or
`from('profiles')` call remains. `npm ls` for all eight removed packages returns `(empty)`.

Added regression coverage:

- Zero-to-current PostgreSQL seeding, full row snapshots/password hashes after the second seed,
  explicit SYP values, tenant-owned rows/counts, local-only guards and incompatible USD rejection.
- Real generated identities/roles and API replacements; ledger balance and clinical portal;
  anesthesia history/blocked confirmation; real filesystem image uploads, authorized streams,
  retained versions and missing-inference failed/null result.
- Private filesystem overwrite/traversal/configuration tests; private mail/production rejection;
  generated configuration no-overwrite; actual Vite denial of private files.
- Browser landing fonts/WASM and dentist upload/versioning with external requests blocked,
  unauthorized image access and disabled inference.
- StrictMode native queued-close regression in the shared dialog. This fixes development usability
  without changing layout, permissions or clinical rules. Production web builds explicitly use
  production React despite the backend's local development `.env`.
- CSP regression: allow local WebAssembly compilation via `wasm-unsafe-eval` while retaining
  same-origin defaults, prohibiting JavaScript `unsafe-eval` and external script/connection hosts.
  The offline browser check verifies rendered canvas content, not merely a successful asset fetch.

Verification used cached/local dependencies, PostgreSQL 17.11 and disposable UUID-named test
databases. GitHub Actions is configured, not claimed remotely run.

| Command / check                                                           | Result                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                  | Exit 0; 538 packages added, 545 audited; four moderate audit findings.                                                                                                    |
| `npm run dev:configure`                                                   | Exit 0; generated private local settings; separately verified refusal to overwrite existing settings.                                                                     |
| `npm run infra:up:local`                                                  | Exit 0; local PostgreSQL healthy with named volume and loopback publishing.                                                                                               |
| `npm run dev:seed` (twice)                                                | Both exit 0; nine reviewed migrations from empty database; same fixture counts and no duplicate rows. Integration snapshots also prove unchanged hashes/history on rerun. |
| `npm run test:integration --workspace @dentalai/database`                 | Exit 0; 20 tests pass, including clean migrations, upgrade preservation and constraints.                                                                                  |
| `npm run test:e2e`                                                        | Exit 0; four real PostgreSQL/browser flows pass in 1.7 minutes; no retries.                                                                                               |
| `npm run smoke:local` with `npm run dev`                                  | Exit 0; six generated users authenticate, read permitted domains and log out; readiness returns 200 with database `ok`.                                                   |
| Private Python environment: `python -m pytest services/ai/tests -q`       | Exit 0; 10 tests pass; one pre-existing deprecation warning.                                                                                                              |
| `npm audit --json`                                                        | Exit 1; four moderate, zero high/critical (details below).                                                                                                                |
| Redacted Gitleaks stdin scan of diff + nonignored untracked files         | Exit 0; no leaks found. Ignored generated credentials/mail are deliberately not published in the scan output.                                                             |
| `node scripts/check-artifacts.mjs`; `git diff --check`                    | Both exit 0; preserved existing ML history, no new large model/dataset artifacts or whitespace errors.                                                                    |
| Requested code/config/lockfile/bundle searches; `npm ls` removed packages | No runtime Supabase occurrences; removed packages `(empty)`; historical documentation classified above.                                                                   |

Backend command `npm run test:integration --workspace @dentalai/api`: **exit 0**, 130 passed,
one optional real-S3 test skipped (303 seconds). This covers role/tenant denials, authentication
reset/revocation, transaction rollback, database concurrency, clinical/financial integrity and
private storage. The real S3 skip is not claimed as a pass; filesystem integration ran fully.

Final unit command `npm test`: **exit 0**, 44 frontend tests and 77 backend tests pass.
Strict workspace type checking, ESLint with zero warnings and repository formatting checks pass.
Final root `npm run verify`: **exit 0**, including production web/API/package builds and the
high/critical audit gate. Vite emits two existing third-party Zod annotation warnings, not errors.
`npm start` independently served the built application without Vite; readiness and landing page
both returned 200, then `npm run smoke:local` again exited 0 for all six synthetic users.
Redacted, network-disabled Gitleaks `git --log-opts="--all"` additionally scanned all 11 commits
(5.47 MB) and exited 0 with no leaks. This does not certify dataset provenance or OS permissions.

The verification server was stopped and the explicitly disposable PostgreSQL test container removed
(ephemeral synthetic fixtures only). The new development Compose database/named volume and private
generated configuration remain available locally; start the application with `npm run dev` or `npm start`.
No source/old self-hosted records, valuable datasets or model artifacts were deleted.

The audit chain is development-only `drizzle-kit` → `@esbuild-kit/esm-loader` →
`@esbuild-kit/core-utils` → vulnerable nested `esbuild` (GHSA-67mh-4wv8-2f99).
The suggested forced change is a breaking downgrade to `drizzle-kit` 0.18.1; it was not applied.
Do not expose that development server to untrusted origins. The existing high/critical audit gate
passes; this does not mean a zero-finding audit.

Intermediate failures were fixed and rerun: broad untargeted seed conflicts hit PostgreSQL's
deferrable exclusions (ID inserts now explicitly target `id`); upgrade fixture forced termination
raced pool cleanup (normal drop now follows pool closure); StrictMode queued dialog close dismissed
reopened dialogs (regression added); the first full browser run exceeded its old 180-second total
budget (now 300 seconds, unchanged per-test timeout/no retries); the animation initially configured
an unused standalone player instead of the React wrapper, then CSP prevented compilation (correct
wrapper/local URL and narrow WASM permission now tested). The browser canvas assertion required
adding the DOM library to the E2E-only TypeScript configuration; strictness remains unchanged.
No test skip was added for these failures.

`npm run test:ai` could not find `uv` on this machine's PATH. The already installed private Python
environment's `python -m pytest services/ai/tests -q` passed all 10 fixtures with one existing
Starlette/httpx deprecation warning. CI installs pinned `uv` before the frozen test command.

## Remaining risks and manual steps

- No source counts/backup were obtainable; this approved reset deliberately replaces migration.
- Hosted project shutdown, secret revocation and public-policy retirement are operator actions not
  performed here. The local application must not depend on that project.
- Real MinIO integration still requires a reachable approved service; filesystem tests are not
  proof of MinIO availability, encryption or production deployment readiness.
- Windows requires explicit ACL restrictions on private files, mail tokens, volumes and backups;
  Node mode bits alone do not establish an access policy.
- Dental model/evaluation and anesthesia references/golden cases await approval. Engineering
  checks are not clinical validation; recommendation/confirmation output remains blocked.
- ML artifacts are unchanged. Licensing/de-identification still require evidence and the
  documented artifact-store migration.
