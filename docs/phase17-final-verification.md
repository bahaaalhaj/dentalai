# Phase 17 — final verification

Date: 2026-10-14. Branch: `phase17-ui-ux-restoration`.
Verification base: `fc9560124bef5a7386017125a69cde4bd166464c`.

## Verdict and scope

Phase 17 UI/engineering verification passed locally within the documented fixture
and Chromium scope: 26/26 new browser cases and 6/6 original workflows, including
actual development HMR and compiled-server strict CSP. Type, quality, build and
coverage gates pass without lower thresholds. One existing real-S3 integration
test remains skipped; remote Phase 17 CI had not run at local verification. This is not production,
regulatory or clinical approval.

At local verification, no commit, stage or push had been performed. The subsequent
user-authorized handoff stages only the 71 meaningful files, excludes all 137
content-unchanged normalization flags and commits/pushes the existing Phase 17
branch. Merge, release, deployment and history rewriting remain prohibited. No original SRS
PDF change or valuable dataset/model/backup deletion was performed. The user's
pre-existing photo manifest remains byte-for-byte equal to the ignored checkpoint.
The repository still has LF-normalization metadata flags on canonically unchanged
files; these are not undocumented API/database changes.

## Baseline before material edits

| Command                                     | Baseline result                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                    | Exit 0; 549 packages added, 556 audited; zero vulnerabilities                                                                         |
| `npm run typecheck`                         | Exit 0; all strict workspaces                                                                                                         |
| `npm run lint`                              | Exit 0; zero warnings                                                                                                                 |
| `npm run format:check`                      | Exit 1; 156 Windows CRLF checkouts; canonical Git contents LF                                                                         |
| `npm run i18n:check`, `npm run i18n:arabic` | Exit 0; 410 extracted, 155 explicit keys, 8 exceptions                                                                                |
| `npm run source:check`                      | Exit 0; 218 handwritten modules                                                                                                       |
| `npm test`                                  | Exit 0; 53 frontend + 104 API unit tests                                                                                              |
| `npm run test:db`                           | Exit 0; 20 database + 157 API integration passed; 1 real-S3 skip                                                                      |
| `npm run test:ai`                           | Initially exit 1: uv not on PATH. Existing service interpreter: 15 passed. Restoring documented uv 0.12.23: command exit 0, 15 passed |
| `npm run test:coverage`                     | Exit 0; frontend 53; API 261 passed + 1 S3 skip; all original floors passed                                                           |
| `npm run build`, `npm run bundle:check`     | Exit 0; 3,359,952 bytes / 49 files; largest JS 523,963 bytes                                                                          |
| `npm run test:e2e`                          | Exit 0; 6 passed                                                                                                                      |
| `npm run audit`                             | Exit 0; zero vulnerabilities                                                                                                          |

The initial localhost:3000 diagnostic had no running application, so it was not
recorded as a successful baseline startup. The supplied blank-page report and the
strict-CSP/raw-Vite integration were inspected; the new real runtime tests verify
the correction.

## Candidate command evidence

Ignored detailed command logs are under `.local/phase17-*.log`. No passwords,
environment dumps or clinical images are included in this report.

| Command                                      | Corrected candidate result                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm ci`                                     | Exit 0; 549 added / 556 audited / zero vulnerabilities; two unchanged esbuild-kit deprecation warnings |
| `npm run typecheck`                          | Exit 0; contracts/domain/database/UI/web/API and browser-test configs                                  |
| `npm run lint`                               | Exit 0; no warnings                                                                                    |
| `npm run format:check`                       | Exit 0; all matched files                                                                              |
| `npm run i18n:check`                         | Exit 0; no unextracted UI literals                                                                     |
| `npm run i18n:arabic`                        | Exit 0; 411 extracted + 249 explicit keys; same 8 exceptions                                           |
| `npm run source:check`                       | Exit 0; 239 handwritten modules; same 400-line ceiling                                                 |
| `npm test`                                   | Exit 0 on complete rerun; frontend 74/74 (17 files), API unit 122/122 (21 files)                       |
| `npm run test:db`                            | Exit 0; 20/20 migration/constraint tests, 157/157 API integration tests; 1 real-S3 skip                |
| `npm run test:ai`                            | Exit 0; 15/15; one unchanged Starlette/httpx deprecation warning                                       |
| `npm run test:coverage`                      | Exit 0; Frontend 74 passed; corrected final API rerun 279 passed + 1 S3 skip; floors unchanged         |
| Final API-only coverage rerun                | Exit 0; 279 passed + 1 S3 skip; CLI selector and CSP boundaries directly tested                        |
| `npm run build`                              | Exit 0; all npm applications/packages. Subsequent web/API rebuilds also exit 0                         |
| `npm run bundle:check`                       | Exit 0; 3,775,092 bytes / 58 files; largest JS 548,323 bytes                                           |
| `npm run test:e2e`                           | Exit 0; all original 6 workflows, 4.5 minutes; original time limits unchanged                          |
| `npm run test:ui`                            | Exit 0; all 26 final cases, 9.0 minutes; no retries/skips; includes final mobile currency assertion    |
| `npm run audit`                              | Exit 0; zero vulnerabilities                                                                           |
| `npm run test:gates`                         | Exit 0; 6/6 artifact-baseline, governance, toolchain and security-workflow ordering tests              |
| `node scripts/scan-worktree-secrets.mjs`     | Exit 0; gitleaks found no leaks in diff/new source and documentation                                   |
| `git diff --check`                           | Exit 0                                                                                                 |
| Production source/manifest dependency search | Case-insensitive Supabase SDK/environment identifiers: no matches (rg exit 1 is expected)              |
| Production clinical random-output search     | Literal Math.random in web/API/domain source: no matches (rg exit 1 is expected)                       |

Covered integration paths include live authentication/RBAC, cross-tenant and patient
scope negatives, booking concurrency, transaction/audit rollback, clinical revisions,
invoice/payment/refund reconciliation and authorized private-file history. Tests use
temporary PostgreSQL databases on the dedicated Phase 17 test container, not the
user's PostgreSQL/MySQL instances or real notification providers.
The dedicated Phase 17 verification container was stopped after testing; it was
not deleted, and no user-owned service was stopped.

Latest complete frontend coverage: statements **44.37%**, branches **47.35%**,
functions **32.49%**, lines **44.93%**. Baseline: 37.25/39.23/26.36/37.73%.
Final API coverage: **84.92/76.91/89.48/86.54%**.
Original API floors remain 84.48/76.77/88.65/86.14%; frontend floors remain
36.27/38.49/25.66/36.76%. Nothing is lowered or excluded to make the result pass.

## Failures retained and corrected

- Initial typed UI composition had stale shared-dialog build types and unused badge
  imports. Rebuild/import fixes resolved them; no `any` shortcut was introduced.
- New SVG legends and read-only inspection changed old numeric-grid assertions.
  Assertions now distinguish procedures, actual approvals and unknown teeth; all
  explicit-action and no-write protections remain.
- The CSP test initially matched the substring inside the existing
  `wasm-unsafe-eval` directive. It now tests the exact prohibited script tokens.
  Express's stricter 404 final-handler CSP was also recorded accurately.
- Unsupported Playwright `hookTimeout` configuration was removed; startup-only
  hooks use the supported scoped timeout. Original test limits are unchanged.
- Cold lazy-chart loading on Windows required resolving the real chart before unit
  assertions, not mocking it or changing assertions/time limits.
- A concurrently loaded first browser run exceeded the original 300-second suite
  limit: 3 passed, 1 timed out, 2 did not run. The isolated full rerun passed 6/6.
- One Vitest fork failed to start under concurrent verification: 66 tests completed
  with one unhandled worker error. The complete unit rerun and complete coverage run
  both passed all 74 frontend tests without suppressing the error.
- The first dashboard screenshot assertion ran before its real API responses
  finished. The new visual test now waits for the relevant successful response.
- Desktop menu visibility had a CSS specificity conflict; the responsive menu rule
  now correctly hides desktop-only toggles.
- Mobile chart checks caught actual page overflow. Screen-reader labels on off-screen
  teeth escaped their scroll container; relative positioning contains them within
  their buttons. Intrinsic-width controls were also constrained. No page-wide
  overflow hiding, removed teeth or reduced assertions were used.
- Live CSP checks initially failed due to leading whitespace in the test's directive
  parser, not a permissive policy. Trimmed parsing then proved real React loading,
  exact-origin websocket connectivity and an actual before/after HMR update.
- Repeated visual-test logins hit the genuine authentication rate limiter. The final
  layout fixture restores one real server-issued opaque session per synthetic role,
  validated through the real sign-in/CSRF/me APIs. No limiter was disabled, increased,
  reset or bypassed; authentication/security workflows remain unchanged.
- The final CLI flag-precedence adjustment exposed two untested branches: 271 tests passed but branch coverage was 76.75%, below 76.77%. The actual production selector is now shared with direct argument-precedence tests; additional HTTPS, empty/external-script and invalid-origin cases strengthen the CSP boundary. The corrected API coverage run passed 279 tests and the unchanged floor.
- A diagnostic NodeList spread failed the existing strict DOM type configuration.
  `Array.from` fixes it without widening compiler settings.
- Final mobile billing review caught a currency amount wrapping mid-number.
  Numeric cells and short headers now remain together; descriptions still wrap
  and the table retains local horizontal scrolling for extreme content. A real
  browser CSS assertion protects this presentation-only correction.
- A final concurrent unit/browser run hit the existing 5-second first-dashboard
  unit timeout (73 passed, 1 failed); API unit tests still passed 122/122. The
  expanded browser run passed all 24 layout cases but exhausted its unchanged
  600-second suite budget before the two runtime cases. These are retained as
  failed attempts, not counted as complete passes; final isolated reruns are
  recorded in the command table.

## Visual/accessibility evidence

**102 successful screenshots** (excluding retained overflow diagnostics) are in
`.local/phase17-screenshots/`. All contain synthetic software fixtures, not real
patient images. The complete 26-case run covers every supported role at 1280/390
pixels in English/Arabic, approved public pages, private imaging, SVG chart,
appointment/billing views, owner/admin settings and native mobile drawers.

The new layout suite performs **90 WCAG-tagged axe scans** over those major
authenticated views/drawers, plus the existing workflow accessibility checks.
No rule is suppressed. This is practical engineering evidence, not comprehensive
WCAG certification or a claim about untested browser/device combinations.

Representative reviewed files:

- `dentist-dashboard-1280-en.png`
- `dentist-chart-1280-en.png`
- `dentist-chart-390-ar.png`
- `dentist-imaging-1280-en.png`
- `clinic_owner-administration-390-ar.png`
- `patient-dashboard-390-ar.png`
- `patient-history-390-ar.png`
- `dentist-drawer-390-ar.png`
- `login-1280-en.png`, `register-390-ar.png`, `landing-1280-ar.png`

Public landing/AuthPage sources, package lock, production Helmet policy, Security/
CodeQL workflow and SQL migration directory compare unchanged against HEAD.
The public favicon is the sole deliberate tab-branding addition. English/Arabic
public screenshots retain the existing appearance rather than the historical
unsafe dashboards.

## Bundle, safety and retained limitations

Bundle increased **415,140 bytes** from 3,359,952 to 3,775,092, within the original
5,000,000-byte budget. Largest JS increased from 523,963 to 548,323 bytes, within
750,000. The new actual-data chart is lazy-loaded (350,401 bytes); Lottie WASM is
unchanged at 1,691,944 bytes, within 2,000,000. No dependencies were added/removed/
upgraded and no budget was increased. Existing Zod annotation/500-KB advisory
warnings remain; they are not audit vulnerabilities or suppressed gate failures.

Before: no cohesive internal shell, numeric tooth grid, raw continuous clinical/
administration forms, weak imaging hierarchy, and development React/HMR blocked.
After: server-role shell and dashboards, real scoped counts/charts, selectable SVG
FDI teeth, clinical tabs/provenance/history, private validated previews, structured
invoice tables/summaries and administration tabs; development-only trusted hashes/
exact HMR origin. Production script policy is unchanged.

Clinical restrictions remain: no randomized browser findings, no fake AI confidence,
no medical limits inferred, no anesthesia recommendation without approved references,
no patient clinician-write access, no unauthorized private image URLs, no historical
appointment/record/ledger deletion and no current-tooth-derived historical costs.

Unresolved production/clinical prerequisites: real private-S3 qualification (the
skipped test is a release blocker), approved dental model artifact/licensing/
patient-level evaluation and clinical/regulatory review, approved anesthesia
references/rules/golden cases, Arabic medical terminology review, broader browser/
device qualification and target-deployment TLS/backup/restore/security qualification.
Paginated metrics and the 500-record accessible-directory limit are explicit.
No new production deployment or independent penetration assessment is claimed.
Phase 17 GitHub Actions had not remotely run at local verification because changes
were uncommitted and unpushed; the authorized handoff push triggers them. The new
Quality step preserves all existing gates and adds UI evidence. Triggered runs do
not establish a remote pass until their actual results are available.

## Changed-file inventory

Meaningful content inventory: **71 files** (34 modified tracked + 37 new, including
this report). Git status additionally carries 137 canonical-content-unchanged
LF/metadata flags, including the preserved pre-existing manifest flag; these are
excluded from the handoff commit. No secrets, env files, backups, coverage, downloaded logs, vulnerability
databases, model artifacts or temporary files are part of this inventory.

- `.gitattributes`
- `.github/workflows/quality.yml`
- `.gitignore`
- `README.md`
- `apps/api/src/infrastructure/development-frontend.ts`
- `apps/api/src/server.ts`
- `apps/api/test/unit/development-frontend.test.ts`
- `apps/web/e2e-phase17/layouts.spec.ts`
- `apps/web/e2e-phase17/runtime.spec.ts`
- `apps/web/e2e/administration.spec.ts`
- `apps/web/e2e/appointments.spec.ts`
- `apps/web/e2e/billing.spec.ts`
- `apps/web/e2e/clinical.spec.ts`
- `apps/web/e2e/navigation.ts`
- `apps/web/index.html`
- `apps/web/package.json`
- `apps/web/playwright.phase17.config.ts`
- `apps/web/public/favicon.svg`
- `apps/web/src/AccountPage.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/AppointmentsPage.tsx`
- `apps/web/src/administration/AdministrationPage.tsx`
- `apps/web/src/administration/Profile.tsx`
- `apps/web/src/billing/BillingPage.tsx`
- `apps/web/src/billing/BillingSummary.tsx`
- `apps/web/src/clinical/ClinicalHistory.tsx`
- `apps/web/src/clinical/ClinicianPatientsPage.tsx`
- `apps/web/src/clinical/CurrentRecords.tsx`
- `apps/web/src/clinical/EncounterContext.tsx`
- `apps/web/src/clinical/GraphicalOdontogram.tsx`
- `apps/web/src/clinical/Odontogram.tsx`
- `apps/web/src/clinical/PatientClinicalHistory.tsx`
- `apps/web/src/clinical/ToothGlyph.tsx`
- `apps/web/src/clinical/odontogram.css`
- `apps/web/src/components/AnestheticCalculator.tsx`
- `apps/web/src/dashboard/AppointmentDistribution.tsx`
- `apps/web/src/dashboard/DashboardPage.tsx`
- `apps/web/src/dashboard/PatientsDirectory.tsx`
- `apps/web/src/dashboard/useDashboard.ts`
- `apps/web/src/design-system.css`
- `apps/web/src/design-system/clinical.css`
- `apps/web/src/design-system/components.css`
- `apps/web/src/design-system/responsive.css`
- `apps/web/src/design-system/shell.css`
- `apps/web/src/i18n/LanguageControl.tsx`
- `apps/web/src/i18n/generated.ts`
- `apps/web/src/i18n/interface-arabic.ts`
- `apps/web/src/i18n/messages.ts`
- `apps/web/src/i18n/polish.ts`
- `apps/web/src/imaging/ImagingPage.tsx`
- `apps/web/src/imaging/PrivatePreview.tsx`
- `apps/web/src/imaging/StudyCard.tsx`
- `apps/web/src/imaging/UploadDropZone.tsx`
- `apps/web/src/index.css`
- `apps/web/src/shell/AppShell.tsx`
- `apps/web/src/shell/navigation.ts`
- `apps/web/src/tests/administration.test.tsx`
- `apps/web/src/tests/auth-guards.test.tsx`
- `apps/web/src/tests/clinical-workflows.test.tsx`
- `apps/web/src/tests/doctor.test.tsx`
- `apps/web/src/tests/phase17-dashboard.test.tsx`
- `apps/web/src/tests/phase17-workspace.test.tsx`
- `apps/web/src/ui/PageState.tsx`
- `apps/web/src/ui/SectionTabs.tsx`
- `apps/web/src/ui/StatusBadge.tsx`
- `apps/web/tsconfig.e2e.json`
- `docs/phase17-final-verification.md`
- `docs/phase17-ui-ux-restoration.md`
- `docs/requirements-traceability.md`
- `package.json`
- `packages/ui/src/ActionDialog.tsx`

Stop after Phase 17. UI engineering verification is distinct from production
readiness and clinical validation; neither latter approval is granted.
