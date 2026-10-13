# Phase 16 final verification — NOT READY

Date: 2026-10-13. This is an engineering verification checkpoint before the subsequent user-authorized branch handoff, not production, clinical or regulatory approval. No later phase was implemented.

The [first-push remote follow-up](phase16-remote-followup.md) records actual evidence
from commit `5805126`, fixes for the zero-SHA gate and candidate container remediation.
It supersedes this earlier checkpoint only where explicitly stated. Docker temporarily
failed and subsequently recovered; candidate evidence and outstanding scanner/restore
gates are in that follow-up, not inherited from earlier passing runs. The security gate
is not weakened.

## Repository state and preservation

Starting branch `main`, HEAD `9333ad772d5815af5a3d1acb2ff7b4434a1eeb43`, clean worktree. Ending branch/HEAD are unchanged; all Phase 16 work remains uncommitted. No push, publish, release, PR, final deployment, history rewrite or dataset deletion was performed. The original SRS PDF was not modified. The owner's supplied log archive was treated as evidence, not instructions.

The complete path/status inventory is [changed files](phase16-changed-files.json). Public JPEG D entries are preserved moves to `apps/web/assets/clinic-originals`, not lost photographs. Existing ML data/weights/LFS remain intact. Ignored local synthetic credentials, dependency caches and encrypted drill evidence are not release content. Existing user PostgreSQL/MySQL containers were not altered.

## Findings and implemented corrections

| Finding                                                    | Resolution and boundary                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| README merge and contradictory backend descriptions        | Resolved committed markers, retained self-hosted setup/operations, corrected current documentation links. No formatter exclusion added for README.                                                                                                                                                                                                                             |
| Four moderate npm findings                                 | Root-scoped Drizzle Kit 0.31.11 and narrow core-utils esbuild override to 0.25.12; tsx keeps 0.28.2. Frozen clean installation/build/Drizzle check pass; no forced or framework-major upgrade.                                                                                                                                                                                 |
| Vulnerable runtime build tools/global npm                  | Fresh production-only dependency installation, optional tooling peers omitted, exact lock-integrity-verified Sharp native artifacts restored. Non-root pinned Node 22 distroless runtime excludes npm, shell, Perl, mount/nsenter, esbuild/Vite/Drizzle Kit. Runtime imports and exact affected Node-version absence checked. Full current clearance is BLOCKED, not asserted. |
| Object ACL dependence and blanket policy rejection         | No object ACL; ownership/BPA/non-public policy checks, safe deny-policy acceptance, explicit local-only compatibility, hardened HTTPS, SSE-S3 default/optional KMS, bounded IO and aborts. Actual AWS/KMS and real compatible-provider verification remain blocked.                                                                                                            |
| Missing upload/content/CSRF API documentation              | Contract-derived OpenAPI includes binary PNG/JPEG upload/content schemas, errors, privacy, roles/tenancy and signed-cookie/header/exact-Origin CSRF. Registry parity tests cover 82 implemented route entries with named internal health/monitoring aliases.                                                                                                                   |
| Unbounded/duplicated inference tensors                     | Compact strict `detections-v2`, 1,000 detections/512 KiB ceilings, class/box/hash validation and bounded model identity. Normal Python path does not convert raw outputs to lists. Metadata and normalized rows publish atomically; no fake fallback.                                                                                                                          |
| Stuck/duplicate image work                                 | Durable tenant/actor/provenance idempotency keys, two-minute leases, late-publication rejection and trusted owner-scoped audited reconciliation. Missing/corrupt/ambiguous objects stay private and retained. No automatic clinical deletion.                                                                                                                                  |
| Misleading reminders/guarantees and untranslated interface | Removed unimplemented reminder/partner/treatment guarantees; manually translated normal interface, status/action/fallback/date/error flows. Safe errors do not show backend details. Clinical codes/free text and technical event identifiers stay unchanged pending terminology review. Not a claim of 100% Arabic coverage.                                                  |
| Large images/landing animation                             | Preserved originals, deterministic responsive WebP variants, dimensions/lazy/async decoding, landing-only lazy animation chunk; RTL animation direction repaired and visually checked at 390/1280 pixels.                                                                                                                                                                      |
| Oversized handwritten modules                              | Cohesive guarded domain repository capabilities; appointment page/hook/dialog/settings; API transport/facades; seed/schema modules. Locking/transactions preserved. 400-line gate passes 214 modules; generated catalog/tests/schema artifacts have documented boundaries.                                                                                                     |
| Toolchain/tag drift and missing coverage                   | Exact npm 11.17.0, Node 22+ retained (CI/container Node 22, local 24.19.0), early toolchain guard, one validated RELEASE_TAG, private 0.0.0 policy. V8 JSON/HTML/LCOV reports and unchanged baseline floors run in CI.                                                                                                                                                         |
| Dataset rights/provenance uncertainty                      | Aggregate/hash/LFS inventory, portable configuration, future-artifact gates, reviewed-field templates and fail-closed mandatory governance check. No invented license, consent, de-identification, evaluation or redistribution approval.                                                                                                                                      |
| Shell-free image broke archive inspection                  | Networkless operator-only backup utility uses the already-scanned PostgreSQL image. Empty-volume initialization and archive listing/extraction repaired; actual encrypted restore drill passes.                                                                                                                                                                                |

Detailed exact archive CVEs/upstream states and remediation rationale: [container report](phase16-container-remediation.md) and [147 finding rows](phase16-container-findings.json). Security changes/design: [remaining security gates](phase16-security-design.md). Storage/version compatibility/recovery: [operator notes](phase16-storage-and-recovery.md).

## Commands and final candidate evidence

Commands ran in the Windows worktree unless stated otherwise. PostgreSQL tests use only the owned disposable loopback database; test fixtures create/drop isolated random databases. Do not reuse a real clinical database for these tests.

| Command/check                                                                 | Result                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm 11.17.0 `npm ci` in isolated fresh manifest/lock directory                | PASS, exit 0: 549 packages added, 556 audited; dependency installation only, not a complete clean-clone product smoke. Retained ignored directory `.local/clean-install-80fefb259c6c47bc9673a6d33ce3f9a6`.              |
| `npm ls --all` / latest `npm ls --all --depth=0`                              | PASS, exit 0, no invalid/extraneous dependency tree.                                                                                                                                                                    |
| `npm run typecheck`, `npm run lint`                                           | PASS, exit 0. Strictness unchanged; no production any/type-safety weakening.                                                                                                                                            |
| `npm run format:check`, `git diff --check`                                    | PASS on source verification; final documentation checks recorded in the closing verification below. Windows LF/CRLF notices are not whitespace errors.                                                                  |
| Tracked source/document merge-marker search                                   | PASS: 0 unresolved markers.                                                                                                                                                                                             |
| `npm run i18n:check`, `npm run i18n:arabic`                                   | PASS: 0 newly extractable literals; 410 extracted + 155 explicit keys, 8 enumerated brand/technical exceptions. Dynamic/server clinical content is not certified translated.                                            |
| `npm run source:check`                                                        | PASS: 214 handwritten modules within 400 physical lines.                                                                                                                                                                |
| `node scripts/check-documentation.mjs`                                        | PASS: 40 stable requirements, 83 cited test references, 132 local links before final-report additions; no external-link/clinical-validity certification.                                                                |
| `npm run test:db`                                                             | PASS: database clean/compatible upgrade 20 tests; API integration 157 passed, 1 real-S3 skipped. Migration history has 11 reviewed entries, including new 0010.                                                         |
| `npm run test:coverage`                                                       | PASS after serial rerun: web 53 passed; API/domain unit+integration 261 passed, 1 real-S3 skipped. Counts overlap other runs; do not add them as distinct tests.                                                        |
| `npm run test:ai` with pinned uv 0.12.23 on PATH                              | PASS: 15 tests, 1 Starlette/httpx deprecation warning. Actual deterministic synthetic ONNX fixtures are nonclinical.                                                                                                    |
| `npm test`                                                                    | PASS, exit 0: 53 web + 104 API unit tests, 0 failure/skip.                                                                                                                                                              |
| `npm run test:gates`, `npm run test:backup`                                   | PASS: 3 + 3 tests, no skip/failure. Governance deletion/blank/type bypass, toolchain/tag validation and backup/SAST failure paths.                                                                                      |
| `npm run test:e2e` with disposable DATABASE_URL                               | PASS: latest candidate 6 Chromium flows in 3.2 minutes, 0 failure/skip. Includes keyboard/dialog/axe smoke, booking, financial ledger, approved records, private images and bilingual onboarding/layout.                |
| `npm run build` and final web build                                           | PASS, exit 0, all TS applications/packages. Vite retains an honest >500 KiB chunk warning and upstream Zod annotation warnings; no warning threshold was hidden.                                                        |
| `npm run bundle:check`                                                        | PASS: 3,359,952 bytes / 49 files.                                                                                                                                                                                       |
| `npm audit --json`                                                            | PASS, exit 0: 0 info/low/moderate/high/critical findings. Baseline was 4 moderate, exit 1. npm audit is not a container/Go/Python scan.                                                                                 |
| Gitleaks 8.30.1 pinned image, `git /repo --redact --log-opts=--all`           | PASS: 17 commits, approximately 6.36 MB, 0 leaks.                                                                                                                                                                       |
| `node scripts/scan-worktree-secrets.mjs`                                      | PASS: worktree diff plus then-current 76 untracked source/doc files, approximately 1.37 MB, 0 leaks; final report rerun is recorded in the closing verification below. Ignored local secret files are not shipped.      |
| CodeQL local availability                                                     | BLOCKED: executable absent. ESLint/TypeScript pass but are not CodeQL-equivalent coverage. Historical remote CodeQL passed at the old HEAD, not this diff. New remote workflow not run/pushed.                          |
| `npm run release:build` / `npm run release:build:ai`                          | PASS, exit 0, current private production candidates built; no release published.                                                                                                                                        |
| `node scripts/check-runtime-image.mjs` + networkless Python container smoke   | PASS: actual auth/DB/API/Sharp imports, no build toolchain/exact affected Node versions; AI imports, installers absent and missing model readiness 503.                                                                 |
| `docker compose -f infra/compose.yml config --quiet`, local/pilot equivalents | PASS, exit 0, all three using synthetic validation variables; no production credentials printed.                                                                                                                        |
| `npm run test:restore-drill`                                                  | PASS: actual encrypted quiesced backup, empty destination restore, counts/checksums, session revocation, fresh login and authorized private download. Seed executed twice. No production restore or recovery SLA claim. |
| Real S3 integration `npm run test:integration --workspace @dentalai/api`      | 1 explicitly named RELEASE BLOCKER skip. Local MinIO pulls from Docker Hub/quay were denied; no credentials/provider available. Units are not real provider clearance.                                                  |
| `node scripts/check-governance.mjs production`                                | EXPECTED BLOCK, exit 1: 16 unresolved dataset/model approval fields + missing repository license. Gate rejects missing/blank/non-text fields as well as UNKNOWN markers.                                                |

### Container scan execution and externally blocked checks

The supplied old Security log has **139 HIGH + 8 CRITICAL = 147 package/target findings**, all in the old app image. AI/PostgreSQL scans and later restore steps were not reached. Exact identities are retained, including zlib `will_not_fix` and affected/deferred upstream packages; there is **no accepted risk exception**.

Pinned Trivy 0.75.0 digest `af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa`, `image --scanners vuln --severity HIGH,CRITICAL --exit-code 1`, with no ignore-unfixed/ignore file:

- Default database mirror download: exit 1, five-minute context deadline.
- GHCR database retry: exit 1 after roughly 15 minutes/partial 30 of 127 MiB, HTTP/2 PROTOCOL_ERROR.
- Transport-only retry with `GODEBUG=http2client=0`, unchanged severity/exit policy and 15-minute timeout: exit 1, mirror.gcr.io artifact download context deadline.
- Offline prerequisite checks of app, AI and PostgreSQL: all exit 1 because no valid scanner database is cached. These are **not vulnerability scans or clean results**.

CI's `security:containers` now independently attempts all three images and retains JSON even after one fails; HIGH/CRITICAL including unfixed remains blocking. Compose/restore steps remain after successful scans. Current comprehensive container/SAST clearance and remote CI-green status are **BLOCKED by external evidence/access**, not satisfied by package removal or npm audit.

Built candidate Docker IDs:

- App `sha256:14b26bfbac4df3942b52baeccf65d9b1ec14f3904274eb5bf15841d985ec2099`; Docker-reported size 98,250,182 bytes.
- AI `sha256:bae2fac910180c4355f7ffd200e4dbad3f1d668c56dd78edc2e91652faf9e5f4`; Docker-reported size 110,616,434 bytes.

AI's initial fresh installer download failed with PyPI read timeout. The final build succeeded with the immutable official uv image and same frozen-lock dependency cache from the prior successful build, not an unreviewed dependency substitution. A clean builder still needs access to approved artifact registries. Distribution patch installed `liblzma5 5.8.1-1+deb13u2`. Neither candidate is clinically approved or comprehensively scanner-cleared.

### Intermediate failures resolved or classified

Baseline README formatting failed. A broad esbuild override broke Vite target transformation and was reverted; a workspace-only override did not apply correctly, fixed by the root-scoped dependency. UI mocks/raw-error assertions were aligned with safe localized errors and local validation preserved. A cold full-page onboarding reload caused an assertion failure under load; awaited identity refresh plus SPA navigation now has a regression and real browser test. Coverage had two Windows fork startup errors (38 passing tests was not called a complete run); maxWorkers reduced to 1, with all thresholds/error checks/timeouts unchanged, then all 53 passed. One E2E invocation omitted DATABASE_URL (5 failures/1 not run); rerun with the disposable URL is required, never a live service. An unactivated uv PATH initially prevented `test:ai`; pinned uv PATH restored and all 15 passed. The archive-inspection/empty-volume restore defect was fixed, followed by the successful actual drill. No failure was suppressed.

## Coverage and frontend measurements

### Added regression tests

- API units: `storage-privacy.test.ts` (6), `inference-contract.test.ts` (4), `openapi-routes.test.ts` (3), plus filesystem cancellation and Arabic scheduling formatting (1 each). These account for the increase from 89 to 104 API units.
- Web: `phase16-localization.test.ts` (3), plus awaited membership-refresh/SPA onboarding navigation (1). Unit count increased from 49 to 53. Existing workflow tests retain local validation and assert safe recoverable errors.
- Imaging integration adds NULL-success rejection, concurrent idempotency/provenance, interrupted-run owner/tenant recovery, original analysis replay/late-insert rejection, unchanged legacy storage projection, checksum/missing/corrupt upload recovery, nonempty atomic normalized publication/rollback and retained-object publication failure/retry cases.
- Python: compact-response/count/size and cooperative inference deadline regressions; all 15 current tests execute real production runtime/contract paths with explicitly nonclinical fixtures.
- Browser: added responsive WebP/Arabic visible-image checks; existing onboarding/appointment/clinical/billing/private-image workflows and accessibility smoke remain. No retries/assertion timeout increases were used.
- Operator gates: malformed/blank/deleted governance fields, wrong toolchain and unsafe release tags; actual image import/tool-absence verification and actual encrypted clean-environment restore, not a copied calculator or substitute backup implementation.

| Workspace                                  | Statements | Branches | Functions | Lines  |
| ------------------------------------------ | ---------- | -------- | --------- | ------ |
| Web/UI                                     | 37.25%     | 39.23%   | 26.36%    | 37.73% |
| API/domain (units + actual DB integration) | 84.62%     | 76.84%   | 88.97%    | 86.28% |

Accepted floors remain web 36.27/38.49/25.66/36.76 and API 84.48/76.77/88.65/86.14, respectively. Reports are ignored `coverage/web` and `coverage/api` JSON/summary/HTML/LCOV, uploaded by CI. Frontend coverage is still limited; focused security/domain tests do not make every screen fully covered.

Frontend baseline **17,848,747 bytes / 39 files** → **3,359,952 bytes / 49 files** (about **81.2% reduction**). Sixteen WebP variants total 239,160 bytes. Initial JS grew from 486,211 to 523,963 bytes with the manually reviewed interface catalog; this trade-off is recorded, not hidden. Landing animation JS 324,967 bytes / WASM 1,691,944 bytes is lazy route-only. Budgets: 5 MB total, JS ceiling 750,000 bytes, WASM 2,000,000, other asset 500,000. These are byte checks, not LCP/FPS/availability promises. Desktop/mobile Arabic screenshots were visually inspected; professional clinical Arabic/browser-platform qualification remains pending.

## Migration, recovery and restore evidence

Migration `0010_imaging_resilience.sql` is additive: old terminal JSON unchanged, normalized immutable detections, count/atomic insert/class/pixel constraints and tenant FKs, durable operation records/leases. Successful NULL results are rejected. Existing corrupt rows can intentionally block upgrade and require reviewed investigation; do not delete them to force migration.

Final-image restore evidence retained privately at `.local/restore-drill-b00a5150` (earlier passing checkpoint also retained at `.local/restore-drill-61d61db5`): patients **2**, appointments **3**, ledger events **4**, clinical revisions **4**, available private files **1**; restored SHA-256 `3f08aac827eb4e81870865014eea8263ada81cdf2ff8f14e41c28405063fd9aa`. This is an explicitly synthetic generated image. Encrypted bundle/key remain private; never commit them. Drill projects were stopped without removing their recoverable volumes/backups. Existing user infrastructure was untouched. Operational recovery retains ambiguous objects and audit/history, and is not automatic clinical approval.

## Dataset/model governance and owner decisions

Inventory: dataset **2,540 files / 21,086,666 bytes**; training runs **8 / 50,368,777**; other ML **1,273 / 27,540,507**. **2,550 LFS entries**, no unresolved pointers; **1,269 duplicate content groups/copies**. Zero detected metadata containers/identifier patterns is a limited heuristic, **not de-identification**. No clinical/marketing image rights are inferred from repository presence. See [governance](ml-data-governance.md), [inventory](ml-inventory.json), [dataset card](dataset-card.json) and [model card](model-card.json).

Owner must explicitly decide, with reviewed evidence:

1. May the dataset and existing image assets legally remain public?
2. Which application project license should be adopted after third-party rights review?
3. Is Git history cleanup required, and what retained private backup/coordinated migration is authorized?
4. May model weights be redistributed, under which verified terms?

No destructive/legal action follows automatically from this report. Approve an access-controlled ML repository/artifact-store destination and verify copies before any content removal.

## Unresolved gates, deployment and rollback

**NOT READY.** Technical changes and synthetic tests do not authorize real patient-care use. Required independent gates remain: current container and CodeQL clearance/remote CI, real S3/KMS, clinical/dataset/reference-set evaluation, lawful rights and professional terminology review, operational approval, independent penetration test, TLS/DNS/SMTP, alert routing, off-site encrypted backup and measured RPO/RTO, production restore, MFA/breached-password protection, scoped PostgreSQL RLS and applicable regulated-device assessment. Application tenancy filters/composite FKs are not RLS. No 90% accuracy, 0% error or availability/regulatory approval is asserted; anesthesia output remains disabled.

For a reviewed local technical environment: follow README's pinned install/configure/seed flow. Build with one RELEASE_TAG; use the pilot Compose and mounted-secret validation described in [operations](phase14-operations.md), with [Phase 16 storage/recovery](phase16-storage-and-recovery.md) and [container packaging](phase16-container-remediation.md) overriding stale shell/tool assumptions. Do not deploy a real clinic until gates are approved; no deployment was performed here.

Retain encrypted backup/key separately and preserve old images/content. Deploy migration 0010 before new writers; do not downgrade to old readers requiring raw tensors. There is no destructive down migration: prefer reviewed forward fixes, or an isolated complete pre-upgrade backup restore with session revocation/reconciliation. Never drop clinical history/new detection records to force rollback. Reconciliation never deletes ambiguous private objects. No source/dataset history cleanup was performed.

Stopped at Phase 16; current remote workflows/release gates must not be labeled green merely because locally runnable checks pass.

## Closing verification

### Authorized branch handoff

After this verification checkpoint, the owner explicitly requested a commit and push on `phase16-hardening`, without merging, deployment, release publication or history rewriting. The clean pre-change main commit remains the baseline. Blank environment templates, source/tests/configuration/reviewed migrations/documentation, eight preserved photo moves and 16 optimized WebP variants plus their public checksum manifest are in scope. Runtime environment files, raw downloaded logs, scanner databases, backups, coverage/test output, caches and temporary files are excluded. CI fetches only the eight photo originals from Git LFS so a clean checkout can reproduce optimization without fetching ML datasets. The branch commit/push identity and newly triggered Actions URLs are returned in the handoff response; no prior verification or external gate is retroactively declared green.

Final source/document formatting and Git whitespace checks passed; documentation validation found 40 requirements, 83 test references and 145 local links. Source gate passed 214 modules. Worktree Gitleaks passed with 0 leaks across approximately 1.44 MB and 77 untracked source/doc files. All 174 changed paths are listed in the updated inventory, including the Docker build-context exclusions and AI README. `npx drizzle-kit check --config drizzle.config.ts` passed from `packages/database`; an earlier wrong-directory invocation created an empty root journal, which was removed without touching the actual migrations. Final-image restore passed again. Final app, AI and PostgreSQL offline scanner prerequisites each exited 1 because the vulnerability database is absent; none is scanner-cleared. No external gate becomes green through these checks. The owned disposable PostgreSQL test container was removed after verification; encrypted backups and restore-drill volumes remain recoverable, with no change to the user's existing infrastructure.
