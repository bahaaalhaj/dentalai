# Phase 14 release-readiness report

Date: 2026-10-12. Pre-change checkpoint: `4557897` (`commit13`); the working tree was
clean. Changes are uncommitted. Existing development configuration, user database,
datasets, model history and prior SQL migrations were preserved. Phase 14 only.

**Release decision: NOT READY for real-patient production.** Engineering preparation
and local regression checks are not clinical validation, regulatory approval, a full
ASVS assessment, independent penetration testing or evidence of green remote CI.

## Verification evidence

Commands ran locally unless explicitly marked blocked. Exit 0 does not mean a skipped
external-service test ran.

| Check / exact command                                                                            | Result            | Evidence / limits                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`                                                                                 | PASS, exit 0      | Strict workspace typecheck, ESLint, i18n extraction check, Prettier, unit tests, production builds and high-severity npm audit                                                                             |
| Unit tests inside `npm test`                                                                     | PASS              | Web 49; API 89                                                                                                                                                                                             |
| `npm run test:db` with disposable PostgreSQL                                                     | PASS, exit 0      | Database 20; API 149 passed, one optional live-private-S3 suite skipped. Clean migrations, constraints, auth/RBAC, tenant isolation, concurrency, clinical, billing, imaging and administration covered    |
| `npm run test:e2e`                                                                               | PASS, exit 0      | Five authenticated browser flows, final repeat 3.6 minutes; six axe WCAG 2A/AA and 2.1A/AA scans in doctor/patient appointment and clinical views. Bilingual administration, billing and imaging also pass |
| `services/ai/.venv/Scripts/python.exe -m pytest services/ai/tests -q`                            | PASS, exit 0      | 12 tests; one upstream Starlette/httpx deprecation warning. Missing model returns unavailable, not fabricated detections                                                                                   |
| `npm run test:backup`                                                                            | PASS, exit 0      | Three tests: private key-file validation, authenticated encryption/wrong key/tampering, and SAST missing/high-severity evidence rejection                                                                  |
| `docker build -f infra/Dockerfile -t dentalai-app:phase14 .`                                     | PASS, exit 0      | Root workspace install, native esbuild rebuild, production build/prune and non-root runtime image. Image digest `sha256:747dbe8445e03e33b3e3c127a3d44c973b7b4c655169d9381937a6b7aa863f22`                  |
| `npm run test:restore-drill`                                                                     | PASS, exit 0      | Actual encrypted backup and clean restore; source/destination API readiness, fresh login and authorized synthetic file download/checksum verified                                                          |
| `docker compose -f infra/compose.pilot.yml config --quiet` and optional AI overlay configuration | PASS, exit 0      | Required operator values supplied privately; no configured credentials printed                                                                                                                             |
| `npm audit --audit-level=high`                                                                   | PASS gate, exit 0 | Zero high/critical; **four moderate findings remain**, described below                                                                                                                                     |
| Gitleaks pinned v8.30.1, full Git history                                                        | PASS, exit 0      | 13 commits, approximately 6.16 MB; no leaks                                                                                                                                                                |
| Gitleaks `stdin --redact`, tracked diff and nonignored new files                                 | PASS, exit 0      | No leaks. Ignored private secrets/fixture backup contents not exposed to output                                                                                                                            |
| `node scripts/check-artifacts.mjs` and `git diff --check`                                        | PASS, exit 0      | Existing ML artifacts retained; no new training/model content. Git emits only Windows LF/CRLF notices                                                                                                      |
| Remote GitHub Actions / actual CodeQL analysis                                                   | BLOCKED           | Workflows and fail-closed SARIF gate added; not executed remotely. Private-repository CodeQL availability/license must be confirmed                                                                        |
| Trivy 0.75.0 HIGH/CRITICAL image scan                                                            | BLOCKED, exit 1   | GHCR vulnerability-database download exceeded five minutes; earlier GCR attempt also stalled. **No completed image scan or clean-image claim**                                                             |
| `docker build -t dentalai-ai:phase14 services/ai`                                                | BLOCKED, exit 1   | Registry/PyPI download interruptions; last retry timed out downloading the pinned uv wheel. Local Python tests pass; container execution is unverified                                                     |

Resolved during verification: incorrect child-log binding filtering, an incremental
duplicate logger setting, typed axe import, npm 10/esbuild binary mismatch, Docker Desktop
internal-only fixture port publication, and restored database grants. Regression tests
or the real build/drill cover these fixes; none is described as a pre-existing pass.
CI and containers explicitly use npm 11.17.0; controlled `npm approve-scripts esbuild`
approves installed exact esbuild versions, not arbitrary install scripts.

## Scoped adversarial and load evidence

Final restore evidence is retained privately at `.local/phase14-restore-5464b950/`.
The source was seeded twice using the existing synthetic SYP fixtures. Reconciled
destination counts: 2 patients, 3 appointments, 4 ledger events, 4 clinical revisions
and 1 available image. Row counts, available-file checksums and the complete private
object-tree digest match. Restored sessions were zero before fresh authentication;
noncompleted outbox jobs are held for operator review. The restored API passed the
foundation staging smoke and streamed the exact synthetic file after authorized login.
This is a successful clean-environment drill, not an installed production backup timer
or an off-host/RPO/RTO qualification.

`apps/api/test/integration/hardening.integration.test.ts` adds live PostgreSQL checks
for unsafe database identities/audit mutation, foreign clinical/imaging/availability
IDs, forged booking fields and attacker-origin CSRF. Existing domain suites exercise
role and tenant failures. This is an automated adversarial regression suite, **not**
an independent penetration-test attestation.

A synthetic local load regression exercises real password login, availability,
approved portal records, booking and private PNG upload. Measured p95:

| Operation            |           Requests |                                    p95 |
| -------------------- | -----------------: | -------------------------------------: |
| Login                |                  4 |                                 420 ms |
| Availability         | 25, five-way waves |                               3,704 ms |
| Approved records     | 25, five-way waves |                                 225 ms |
| Same-slot booking    |       2 concurrent | 503 ms; exactly one successful booking |
| Private image upload |                  3 |                                 355 ms |

These are workstation measurements under a 10-second regression budget, not a VPS
capacity/SLA qualification. Sustained load, malicious-image fuzzing and independent
cross-tenant testing on staging remain blocked. Automated accessibility scans do not
replace keyboard/screen-reader review of every workflow.

## Changes and dependencies

- API: mounted-secret/environment validation, private monitoring listener, bounded
  metrics and native request spans, final-output log privacy filtering, aggregate
  safe errors, dependency readiness, HTTP/DB/SMTP timeouts, restricted DB identity
  assertion, worker heartbeat and pre-parser rate limiting.
- Private imaging: authorize tenant before decode; new immutable keys contain the
  authorized clinic UUID; provider metadata reflects the actual private adapter.
  Previous opaque namespaces remain readable. No public storage or fake inference.
- AI: private mounted bearer token and upload timeout; missing model stays unavailable.
- Infrastructure: non-root/read-only app image; private pilot Compose; optional private
  AI overlay; reviewed runtime grants; reverse-proxy include; controlled migration
  command; encrypted quiesced backup/restore, reconciliation and isolated drill;
  timer/service templates, staging smoke and SARIF gates.
- Tests/CI: hardening unit/integration/Python tests, backup failure tests and axe browser
  scans; CodeQL, dependency/secret/container scan and restore-drill workflows.
- Documentation: this report, [scoped ASVS/threat model](phase14-threat-model.md),
  [deployment/recovery/incident/support runbooks](phase14-operations.md), README and
  infrastructure/deployment documentation; names-only configuration examples.

The only application lockfile additions are development-test packages
`@axe-core/playwright@4.13.0` and `axe-core@4.13.0`. No forced dependency upgrade.
Pinned build tooling/base images are recorded in Dockerfiles/workflows.

Remaining npm advisory: [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99),
moderate esbuild development-server exposure, through
`drizzle-kit@0.31.11 → @esbuild-kit/esm-loader@2.6.5 → @esbuild-kit/core-utils@3.3.2
→ esbuild@0.18.20`. npm reports four affected packages, not four independent advisories.
The proposed forced fix is a breaking downgrade to `drizzle-kit@0.18.1`; it was not
applied. Do not expose tooling development servers. The pruned image install still
reports the same moderate chain; do not claim production dependencies are clean.
No high/critical risk exception is approved. Container vulnerability status is unknown
until the scanner completes; that blocks deployment rather than silently accepting risk.

## Failed and blocked release gates

| Status  | Gate                                                     | Required next evidence                                                                                                              |
| ------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| FAIL    | ASVS authentication gaps                                 | Common/breached-password blocklist and MFA/step-up policy implemented/reviewed; no ASVS Level 2 claim                               |
| BLOCKED | All CI green and no high/critical deployed vulnerability | Execute remote quality/SAST/container gates; review every finding. No blanket suppression                                           |
| BLOCKED | Operational observability                                | Restricted log/metric collector, real alert destination and delivery drill. Native spans are not OTLP distributed tracing           |
| BLOCKED | Actual VPS/TLS/mail/security configuration               | Certificate renewal, trusted proxy/firewall, verified SMTP, volume encryption, secret rotation/custody and hostname smoke           |
| BLOCKED | Off-host automated recovery                              | Install/test timer, copy encrypted backups off-host, escrow separate keys, approve legal retention; qualify proposed RPO 24h/RTO 4h |
| BLOCKED | Independent penetration/capacity/accessibility review    | Staging cross-tenant/IDOR assessment, sustained five-workflow load, keyboard and assistive-technology review                        |
| BLOCKED | Tamper-resistant audit custody                           | Immutable off-host evidence and restricted operator process; a host/DB administrator can still alter history                        |
| BLOCKED | S3 recovery                                              | This phase's automated pilot backup supports private filesystem storage only; S3 recovery is not claimed                            |
| BLOCKED | Clinical AI/anesthesia enablement                        | Approved model/reference/evaluation and clinician review remain external clinical gates. Both stay disabled                         |

No patient data was migrated or deleted. Existing user services were not reset. Only
Phase 14-owned disposable containers are stopped after tests; encrypted fictional
drill evidence and named volumes are retained privately for recovery. No later phase
or production deployment was performed.
