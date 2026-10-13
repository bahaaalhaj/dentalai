# Phase 16 remote verification follow-up

Date: 2026-10-13. Scope: existing `phase16-hardening`, after
`580512676e7bbbf410c88136929306821b79105f`. No merge, deployment, release, destructive
database action, history rewrite, clinical-rule change or new product scope.

## Remote evidence, not presumed clearance

The owner-supplied `container-vulnerability-evidence.zip` was interpreted as scan data,
not instructions. SHA-256:
`5ad4905ed78e5ea7274fbdade58d23cff73309e172f47c4042fa1d1f9ab778d0`.
Its three valid Trivy schema-2 reports contain no scanner errors. Only sanitized CVE
metadata is committed in [the exact finding inventory](phase16-followup-container-findings.json);
raw downloads, scanner databases and logs remain outside Git.

| Image at source commit | HIGH | CRITICAL | Outcome                                                       |
| ---------------------- | ---: | -------: | ------------------------------------------------------------- |
| App                    |    0 |        0 | Passed scan for source commit only                            |
| AI                     |   44 |        0 | Failed; eight distinct CVEs, distribution utilities/libraries |
| PostgreSQL             |   24 |        1 | Failed; 25 CVEs in Go 1.24.6 inside `/usr/local/bin/gosu`     |

AI CVEs: util-linux CVE-2026-76642/78408/78409/78410, libacl
CVE-2026-54369, systemd CVE-2026-16742, ncurses CVE-2025-69720, Perl
CVE-2026-9538. All reported fixes are unavailable; exact installed packages and
affected/deferred states are in the inventory. No upstream patch is invented.

PostgreSQL's Critical is CVE-2025-68121. High IDs:
CVE-2025-61726/61729; CVE-2026-25679/27145/32280/32281/32283/33811/33814/33818/
39820/39821/39822/39836/42499/42504/56853/56858/56859/56860/56862/78667/78669/97031.
Each affected binary row and upstream fix range is retained in the inventory.

[Quality run 38438476473](https://github.com/bahaaalhaj/dentalai/actions/runs/38438476473)
failed because the first push's `before` SHA was all-zero; later checks were skipped.
[Security run 38438476494](https://github.com/bahaaalhaj/dentalai/actions/runs/38438476494)
passed both CodeQL languages and their severity enforcement, built the images and
passed the app runtime guard, then failed container scanning. Its Compose and restore
steps were correctly skipped. These results do not verify the follow-up diff.

## Candidate fixes and unchanged protections

- Resolve a real baseline from PR base or nonzero push-before; for a first branch push,
  require the repository default-branch ref and use its merge-base with HEAD. Missing
  refs, invalid/nonancestor SHAs and missing baselines fail closed, not to HEAD.
- Retain the artifact categories and size limit; additionally inspect renamed/copied
  paths. Real temporary-Git tests demonstrate a valid first push and rejection of
  newly added datasets, model weights and renamed weights.
- Upload coverage only after the identified coverage step actually succeeded or failed,
  never when skipped. Failed executed coverage still retains diagnostic artifacts.
- Derive PostgreSQL from the pinned existing 17.11 Alpine image. Replace only `gosu`
  with [su-exec](https://github.com/ncopa/su-exec), preserving init/permission logic and
  PostgreSQL version. Deployment, CI tests, scans and backup tools use this same derived
  image. Its build checks the exact entrypoint match and privilege switch. No Go binary
  or vulnerable stdlib is retained by design; startup still needs container verification.
- Preserve Python 3.12, ONNX execution and the frozen dependency lock, but assemble an
  inference-only runtime on pinned [distroless cc](https://github.com/GoogleContainerTools/distroless).
  Copy only genuine linked distribution libraries and their package metadata/copyrights.
  Exclude unused interactive terminal extensions and UUID acceleration; stdlib secure UUID
  fallback remains. Assembly fails on unresolved or unauditable native dependencies.
  No package provenance is hidden to obtain scanner clearance.
- Add actual-container native-import, UUID, missing-model readiness and PostgreSQL
  privilege-switch guards. Existing app runtime guards remain in force. CodeQL's entire
  job is byte-for-byte unchanged, asserted by regression tests against the source commit.
- Keep the scanner pinned, scan all three candidates independently, include unfixed
  HIGH/CRITICAL, and exit nonzero for findings/errors. No ignores, exclusions or accepted
  CVE exceptions. Security Compose validation and restore remain after scan clearance.

## Local verification of this candidate

During local builds the assembler rejected an unused Tkinter extension whose GUI
libraries were absent even in the slim builder; GUI extensions are now explicitly
omitted. Debian ELF-loader diversion notices are distinguished from real package-owner
records, and added copyright files use a separate namespace to preserve distroless's
own documentation symlinks. These failures were corrected, not bypassed. The rebuilt
AI image passes native imports and real deterministic ONNX mean execution on synthetic
pixels at absolute tolerance `1e-6`, plus missing-model readiness. PostgreSQL uses pinned
`su-exec=0.3-r0` and reports version 17.11.

The first full API integration run reported 156 passes, one failure and one optional S3
skip. The failed assertion was successful encounter closure receiving 409 at the old
test's line 232; an isolated rerun passed. Expected-success reject/close operations now
use the existing bounded fixture helper that retries **only** `CLINICAL_CLOCK_CONFLICT`
after PostgreSQL wall-clock recovery. It never retries permissions, arbitrary conflicts
or server errors. Pending-review and repeated-review assertions now require their exact
domain error codes. Production clock rejection is unchanged, and the explicit regressed
clock/rollback test is retained. The complete clinical suite then passed all 21 tests;
full coverage/integration verification is rerun rather than declared green from that subset.

| Command/check                              | Result                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `npm run typecheck`                        | PASS, exit 0                                                                            |
| `npm run lint`                             | PASS, exit 0, zero warnings                                                             |
| `npm test`                                 | PASS: web 53, API unit 104                                                              |
| `npm run test:ai`                          | PASS: 15; one upstream Starlette/httpx deprecation warning                              |
| `npm run test:gates`                       | PASS: 6, including real Git fixture and workflow ordering                               |
| `npm run test:backup`                      | PASS: 3 backup/SARIF failure-path tests                                                 |
| Web coverage                               | PASS: 53 tests; statements 37.25%, branches 39.23%, functions 26.36%, lines 37.73%      |
| `npm run build` and `npm run bundle:check` | PASS; 49 files, 3,359,952 bytes                                                         |
| `npm run i18n:check`                       | PASS: 410 generated, 155 explicit, 8 documented exceptions                              |
| `npm run source:check`                     | PASS: 217 modules                                                                       |
| `npm audit --json`                         | PASS: zero vulnerabilities in all severity classes                                      |
| New-branch zero-SHA simulation             | PASS: merge-base `9333ad772d5815af5a3d1acb2ff7b4434a1eeb43`; full artifact range passes |
| Native Gitleaks 8.30.1 full history        | PASS: 18 commits, zero leaks; official binary checksum verified                         |

Additional verification:

- Fresh isolated root `npm ci --offline`: PASS, preinstall guard runs; 549 packages
  added from existing npm cache with zero audit findings. This is cached installation,
  not proof of an internet-independent fresh cache.
- All three candidate container builds: PASS, exit 0 after build corrections.
- Actual AI/PostgreSQL runtime guards: PASS; app import/toolchain guard also passed.
- Clean PostgreSQL migration/constraint tests: PASS, 20 on an owned disposable candidate.
- Complete clinical integration suite: PASS, 21 after narrow fixture correction.
- Local, offline-local and pilot Compose syntax: PASS, exit 0; not a restore claim.

Formatting, documentation/link checks, final staged secret/whitespace checks and remote
follow-up identities are recorded in the handoff, not assumed from the source commit.
No npm or Python dependency versions changed in this follow-up.

## Blocked and remaining gates

Docker Desktop's Linux engine initially stopped responding, then its named pipe
disappeared. The owner confirmed failure, then later restored the engine. No user
infrastructure was restarted or removed. Verification resumed on the derived images
and an owned disposable PostgreSQL instance, without changing the existing user containers.
The Trivy vulnerability-database download remains an external prerequisite; slow or
failed download is BLOCKED, not zero findings. An additional official GHCR database
download attempt exited 1 with an anonymous token-request `DENIED` response.
Local Compose syntax validation is not runtime verification. Restore remains gated on
actual scanner clearance; previously passed restore evidence is historical, not candidate proof.

Remote CI must establish candidate builds/guards/scan clearance and then actual Compose
and restore success. Quality must actually proceed past the artifact gate. A regression
test for workflow order is not evidence those remote steps ran. Do not release this
candidate while any HIGH/CRITICAL finding, build error or external gate remains unresolved.
Clinical/model/reference approvals remain pending; anesthesia recommendations stay disabled.
