# Phase 15: final repository verification and documentation alignment

Dates: 2026-10-12 to 2026-10-13, Asia/Baghdad. Pre-change checkpoint:
`84b9d16` / `commit14`, clean working tree. **Documentation/verification-only change: no product
code, medical constants, migrations, dependencies, authorization or feature scope changed.**
Original academic SRS reviewed in full (23 pages), including rendered source tables.
The supplied PDF stays unchanged outside Git. [Aligned SRS](srs.md) records its date/hash,
stable requirement IDs, five-role tenant model, use cases, data/deployment/trust model,
future scope and qualified nonfunctional targets. [Traceability](requirements-traceability.md)
maps every functional/nonfunctional ID to actual code/tests or an explicit evidence gap.

**Final decision: engineering verification passes where stated below; real-patient
pilot/clinical release is not approved.** Remote CI, Python container and image-security
evidence remain blocked. No clinical validation, regulatory compliance, uptime or
blanket encryption/retention guarantee is claimed.

## 1. Implemented requirements

Verified functional groups include server-owned auth/session recovery and revocation;
clinic tenancy and five-role enforcement; isolated onboarding/staff/configuration;
administrative subscription state and DB quotas; anonymized availability and atomic
collision-safe appointment lifecycle; existing-patient encounters, authored revisions,
explicit FDI/surface odontogram, treatment plans and approved read-only patient history;
immutable invoices/payment/refund/adjustment ledger and patient receipts; private
validated image versions/streams; transactional audits; real email-provider/outbox
infrastructure; owner-only export/non-destructive offboarding; encrypted local backup
and clean restore tools. See FR IDs in the SRS for precise boundaries.

## 2. Partial and blocked requirements

Partial: existing-patient directory lacks text search/general patient creation/linking UI;
English/Arabic interface preparation lacks approved medical Arabic; private inference
engine/review infrastructure lacks an approved dental artifact; anesthesia structure
persists safe blocked outcomes but calculates no patient limit/recommendation; local
backup tools/timer templates are not deployed off-host automation; native bounded spans/
metrics are not a provisioned distributed-tracing/alert backend.

Blocked: approved model/reference sets and clinician golden cases, licensing/consent/
de-identification and patient-disjoint evaluation; clinical/regulatory/legal review;
remote CI/CodeQL and completed container scan; AI production image; real TLS/SMTP,
disk encryption, separate-key/off-host custody and legal retention; MFA/password blocklist;
independent penetration testing, sustained VPS load and broader browser/device/AT qualification.
Future (not silently implemented): Twilio/WhatsApp/SMS reminders, Stripe processing,
DICOM/PACS, offline IndexedDB synchronization, mobile apps, OAuth login, and treatment/
monthly-revenue chart analytics. Issued-invoice totals/manual financial records are not Stripe.

## 3. Commands and exact observed results

Local environment: Windows, Node **24.19.0**, npm **11.17.0**, PostgreSQL **17.11**.
Configured CI uses Node22; local Windows success is not remote Linux CI evidence.
The clean checkout is a Git archive of the reviewed checkpoint into an isolated temporary
directory without ignored `.env`, node_modules or built files. Tests use a separately
created loopback PostgreSQL container, never the user's existing development database.

| Command / verification                                                                                                                                       | Exit / result         | Evidence and qualification                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git status --short`, `git log -3 --oneline` before edits                                                                                                    | 0; clean at `84b9d16` | Existing operator work preserved                                                                                                                                                                                   |
| `git archive HEAD --output <temporary-checkpoint.tar>`; `tar -xf ... -C <clean-checkout>`                                                                    | 0                     | Clean source export; source PDF/secrets/ignored assets not copied                                                                                                                                                  |
| `npm ci --prefix <clean-checkout>`                                                                                                                           | 0                     | 540 packages added, 547 audited; four moderate findings; deprecated esbuild-kit and unapproved install-script warnings, not suppressed                                                                             |
| `npm run build` in clean checkout                                                                                                                            | 0                     | Shared packages, React/Vite and compiled API build without local env; two upstream Zod annotation warnings                                                                                                         |
| `npm run verify` in working repository                                                                                                                       | 0                     | Strict typecheck, zero-warning ESLint, i18n extraction check, formatting, unit tests, builds and high-severity dependency gate                                                                                     |
| Unit tests (`npm test` inside verify)                                                                                                                        | 0                     | **49 web + 89 API**, 31 test files                                                                                                                                                                                 |
| `npm run test:db` using disposable `DATABASE_URL`                                                                                                            | 0                     | **20 database + 149 API integration passed; 1 optional S3 test skipped**. Ten migrations from zero, upgrade/history rollback, seed idempotency, all role/tenant domains and races                                  |
| `npm run test:integration --workspace @dentalai/api -- test/integration/hardening.integration.test.ts --reporter=verbose`                                    | 0                     | Three actual DB adversarial/load tests; re-run measurements below (already counted in full integration total)                                                                                                      |
| `npm run test:e2e` against real API/production web build                                                                                                     | 0                     | **5 passed, 3.5 minutes**: bilingual onboarding, appointments, clinical approval/correction/patient view, financial receipts/refund, private images/unavailable inference; six axe scans                           |
| `services/ai/.venv/Scripts/python.exe -m pytest services/ai/tests -q`                                                                                        | 0                     | **12 passed**, one upstream Starlette/httpx deprecation warning; actual synthetic deterministic ONNX, split validation and missing-model failures                                                                  |
| `npm run test:backup`                                                                                                                                        | 0                     | **3 passed**: private key validation, GCM tamper/wrong-key refusal, fail-closed SARIF gate                                                                                                                         |
| `npm run test:restore-drill`                                                                                                                                 | 0                     | Real PostgreSQL/object backup and restore into clean isolated volumes; source/destination readiness, revoked sessions, fresh login and authorized image checksum                                                   |
| `docker build -f infra/Dockerfile -t dentalai-app:phase15 .`                                                                                                 | 0                     | Builds web/API/packages in pinned Node22 image; no clinical enablement. Manifest digest `sha256:91aef16e957ef8b33c976598e9fdb7f4e9f8d571988d823aa269fb5ca2469ca9`                                                  |
| `docker build -t dentalai-ai:phase15 services/ai`                                                                                                            | **1, blocked**        | Build reached pinned Python3.12 image, then pip reported no available distribution for pinned `uv==0.12.23`; container dependency resolution did not complete. Local tests do not substitute for this build        |
| `npm audit --audit-level=high` inside verify                                                                                                                 | 0                     | **0 high/critical, 4 moderate** in esbuild/Drizzle tooling chain; no forced upgrade                                                                                                                                |
| Pinned Gitleaks v8.30.1 `git /repo --redact --log-opts=--all`                                                                                                | 0                     | **14 commits**, approximately **6.28 MB**, no leaks                                                                                                                                                                |
| Pinned Gitleaks `stdin --redact` for final tracked diff/new docs                                                                                             | 0                     | No leaks in either scan; private ignored credentials/backup contents not printed                                                                                                                                   |
| Trivy0.75.0 `image --db-repository ghcr.io/aquasecurity/trivy-db:2 --timeout 5m --scanners vuln --severity HIGH,CRITICAL --exit-code 1 dentalai-app:phase14` | **1, blocked**        | Vulnerability database download timed out after five minutes (about 6.76/126.85 MiB); **no completed scan, no clean-image claim**. Scanned candidate has unchanged production code; new image must also be scanned |
| `node scripts/check-documentation.mjs`                                                                                                                       | 0                     | 40 unique requirements, 83 cited test references and 124 local file links verified; external links/anchors and medical validity not certified                                                                      |
| `npm run lint`, `npm run format:check`, `git diff --check` after documentation edits                                                                         | 0                     | Zero ESLint warnings, formatting and whitespace checks pass; no invented passing original-SRS target                                                                                                               |

Final test count: **327 passed**, one optional S3 test skipped; repeated tests are not
counted twice. Verification commands cover authorization through real-role/domain
integration suites, not only mocked UI guards. No live hosted database or patient images
are needed. Fixture ONNX is nonclinical and forbidden outside tests. No external dental
golden fixture or actual private-S3 service test was substituted with fabricated output.

### Restore evidence

Private synthetic evidence: `.local/phase14-restore-d0a3edae/` (the existing harness
retains its Phase14 directory prefix). The existing seed ran twice. Restored counts:
**2 patients, 3 appointments, 4 ledger events, 4 clinical revisions, 1 available file**.
Counts/object-tree and available-file SHA-256/size match. Restored sessions were zero
before a new login; pending outbox delivery is held for review. The destination served
the authorized synthetic image with the same checksum. No real user database was reset.
Encrypted evidence/named drill volumes remain recoverable; no deployed RPO/RTO is established.

### Performance and maintainability evidence

Phase15 targeted regression p95, workstation only: login **418ms** (4 requests),
availability **3,640ms** (25 requests, five-way waves), approved records **229ms**
(25/five-way), booking **714ms** (two competitors, one winner), upload **527ms**
(3). The test's 10-second regression ceiling is not a new product SLA. The original
2s/3s targets lack defined load/hardware percentiles; 20 simultaneous users and
5s dental inference were not qualified. No uptime/MTBF/MTTR history exists.

Physical source-line measurement: AppointmentsPage.tsx **918** (original <=400
component requirement fails); clinical repository **880**, administration **787**,
billing **765**, scheduling **728**, API client **562**. These repositories are not
React components but are maintenance risks. Generated i18n **846** is generated data.
Strict TypeScript/null checks plus noUncheckedIndexedAccess/exactOptionalPropertyTypes
and related checks pass; skipLibCheck is true. Legacy test-only xray-utils still has
an explicit any and is not bundled production logic. Python/SQL/mjs are deliberate
language boundaries; no 100% TypeScript claim. No component refactor in this phase.

Chromium desktop is the only executed browser project. Chrome/Safari/Edge parity,
Firefox/tablet/iOS/Android/macOS, GPU/FPS/heap/low-bandwidth targets are not certified.
Automated axe scans do not replace keyboard/screen-reader/manual terminology review.

## 4. Runtime boundary searches

Run from root; **exit 1 is the expected no-match result** for git grep/rg. npm ls
also returns 1 for the requested missing package, with `(empty)` rather than a runtime
dependency. No secret values were searched into output.

```powershell
git grep -n -i supabase -- apps packages services infra scripts .env.example package.json package-lock.json
git grep -n -E 'Math\.random|np\.random|numpy\.random|random\.' -- apps/web/src apps/api/src packages/domain/src services/ai/app/main.py services/ai/app/runtime.py
npm ls @supabase/supabase-js --all
rg -l -i 'supabase|VITE_SUPABASE|DATABASE_URL|postgresql://' apps/web/dist -g '*.js' -g '*.html'
```

All four returned expected no-match/empty status **1**. Historical hosted terms exist
only in explicitly historical documentation, not production code/config/manifests/
lockfile or browser bundle. No randomized clinical-generation call is present.
Broader randomness search has one intentional `np.random.default_rng` in offline
`services/ai/app/evaluation.py`: patient-cluster bootstrap confidence intervals, not
endpoint inference or simulated findings. CSPRNG object/session IDs are security
identifiers, not fabricated clinical output. The frozen browser analyzer always throws;
actual tests spy on randomness and assert no finding or anesthesia dose is returned.
Former hosted project shutdown/revocation is still an operator action, not implied by
SDK removal. The approved source was disposable test data; no legacy migration claim.

## 5. Clinical validation and security status

Clinical: no approved dental model/evaluation/license/split manifest or approved
anesthesia references/formulary/dose limits/golden cases. All pending clinical rules
are listed in [anesthesia notes](anesthesia-decision-support.md). Dentist review is
a recorded decision, not approval of software. Both experimental outputs remain
unavailable by default; anesthesia cannot produce numeric dose output even with a demo flag.
Original diagnostic, 90%-accuracy and 0%-error assertions are replaced by qualified
AI-assisted decision support requiring clinician confirmation and explicit blocked status.

Security: server membership/tenant SQL integrity, safe API contracts, CSRF/Secure cookies,
private immutable streams, restricted pilot DB identity, allowlisted logs and bounded
operational metrics have local regression evidence. **Not** per-tenant PostgreSQL RLS,
MFA, independent pentest or tamper-proof administrator custody. Audit contains sensitive
clinical before/after information; it needs restricted storage, not ordinary request logs.
AES-256-GCM backup and notification envelopes have narrow concrete evidence, not
blanket DB/disk/TLS1.3 encryption certification. Retention/purge jurisdiction decisions
and regulatory review are unresolved. Clinical/history rows are retained, not automatically erased.

Remaining npm advisory: **GHSA-67mh-4wv8-2f99**, moderate esbuild dev-server exposure,
through drizzle-kit0.31.11 -> esm-loader2.6.5 -> core-utils3.3.2 -> esbuild0.18.20.
Four affected packages represent one dependency-chain advisory. The suggested forced
fix is a breaking downgrade; it was not applied. Never expose tooling development
servers. Image vulnerability status is unknown while scanning is blocked; no high/
critical exception is approved. Remote quality/CodeQL/container workflows are configured,
not proven executed/green; private-repository CodeQL access must be confirmed.

## 6. Deployment and remaining work

Local synthetic development only:

```bash
# Node22+ and npm11.17.0; Docker Compose. Fresh checkout, no copied credentials.
npm ci
npm run dev:configure
npm run infra:up:local
npm run dev:seed
npm run dev
```

Configuration generation refuses overwriting existing files; seeding is idempotent,
development-only and explicitly SYP/no conversion. Use [README](../README.md) for
verification setup and [operations](phase14-operations.md) for mounted secret names,
restricted DB grants, migration identity, HTTPS edge, SMTP, private volumes, rollout/
rollback, encrypted backup/restore, monitoring, incident and support procedures.
Do not use the local seed credentials/fixture data for production. Do not run destructive
down migrations or reuse the disposable drill overlay as a production network policy.

Before a **synthetic/internal pilot**: complete Python image and container/SAST/remote
CI gates; provision HTTPS/SMTP/monitoring/secret custody; install/test backup timer and
off-host copy/key escrow; rehearse migration/rollback; verify chosen private storage,
manual accessibility/Arabic terminology and actual workstation/VPS load. A synthetic
pilot does not permit patient-care recommendations.

Before **real patient/clinical use**: additionally resolve MFA/password protection,
independent cross-tenant/security review, legal/privacy/retention/consent/licensing,
operational recovery objectives and audit custody; qualify full workflows and supported
browsers/devices. Enable experimental clinical outputs only after approved models/
references, patient-level held-out evaluation/calibration and clinician golden cases,
independent clinical validation and applicable regulatory authorization. No unsupported
guarantee substitutes for those gates.

## 7. Documentation delta and scope preservation

Added `docs/srs.md`, `docs/requirements-traceability.md`, this report and structural
verification tool `scripts/check-documentation.mjs`. Run it from the root to check
unique IDs, complete matrix coverage and real local test/link targets.
The existing quality workflow now runs this structural documentation gate; remote execution
is still not claimed. Aligned README,
architecture/ADR, API foundation, authentication, scheduling, clinical safety, schema,
private imaging, security and AI README. Historical Phase3/6/7/10/11/13 reports now
explicitly identify their checkpoint, preserving original run evidence rather than
pretending old counts/hosted paths describe current production.

Original interface/audit/handshake omissions are replaced with actual boundaries and
operations. Removed current claims of hosted architecture, role lookup by profiles,
cyclic tooth state, second anesthesia AI, mandatory cloud internet, realtime sync,
unimplemented payment/notification/mobile/PACS features, uniform browser support,
zero error/accuracy/uptime/regulatory/legal-retention guarantees. No product behavior
was removed, no credentials copied, no model/dataset content deleted, and no later phase
implemented. The original SRS file is not edited or re-exported.
