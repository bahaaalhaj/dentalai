# Container vulnerability remediation

## Follow-up evidence from the first branch push

The newer archive for commit `580512676e7bbbf410c88136929306821b79105f` supersedes
the old archive below for that commit's images, not for the subsequent candidate.
It contains **0 app**, **44 AI HIGH**, and **24 PostgreSQL HIGH plus 1 CRITICAL**
findings, with no scanner errors. See [exact sanitized finding rows](phase16-followup-container-findings.json)
and the [follow-up implementation and verification report](phase16-remote-followup.md).
Candidate remediation is not yet container-verified; no findings are suppressed or accepted.

The owner's attached GitHub archive is evidence, not an instruction source. Archive SHA-256: `5d97f7228d1b188622aee30a83249322ab3a96fe514c2315607ba5aab345baad`. The exact 147 finding rows are retained in [machine-readable evidence](phase16-container-findings.json), including affected version, upstream fix and status. Counts are package/target findings, not unique CVEs: **139 HIGH and 8 CRITICAL**. The old workflow stopped on the app image; it did not establish AI/PostgreSQL clearance.

## Critical findings in the attached report

| Target                        | CVE                                           | Reported version / upstream remedy             | Implemented remediation                                                                                                                  |
| ----------------------------- | --------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Perl                          | CVE-2026-13221, CVE-2026-42496, CVE-2026-8376 | 5.36.0-7+deb12u3 / deb12u4                     | Perl is absent from the new distroless HTTP runtime; absence is checked against the actual image.                                        |
| zlib                          | CVE-2023-45853                                | 1:1.2.13.dfsg-1 / `will_not_fix` in old report | New pinned Debian 13 runtime; no exemption. Needs current scanner evidence and review of MiniZip reachability if still reported.         |
| core-utils esbuild Go stdlib  | CVE-2024-24790                                | Go 1.20.7 / 1.21.11 or 1.22.4                  | Build-only esbuild removed from runtime. Narrow reviewed npm override also removes esbuild 0.18.20 from the development dependency tree. |
| all three esbuild Go binaries | CVE-2025-68121                                | Go 1.20.7 or 1.23.12 / 1.24.13 or 1.25.7       | All esbuild, Drizzle Kit, Vite and esbuild-kit runtime paths are prohibited by the image guard.                                          |

## High findings and controlled changes

The archive includes 56 Debian findings, 11 Node-package findings and 80 Go-binary findings. Node findings cover brace-expansion (five CVEs; upstream 2.1.6), http-cache-semantics CVE-2026-93748, ip-address CVE-2026-69192, pacote CVE-2026-9496 (two installed versions), picomatch CVE-2026-33671 and sigstore CVE-2026-48815. Most occurred in global npm/build tooling. The final HTTP image has no npm, package manager, shell, mount/nsenter, Perl or build toolchain; it installs runtime packages afresh rather than pruning a hoisted development tree. Optional tooling peers are omitted; only the exact locked Sharp native libraries are reintroduced after integrity and archive-path verification. Every installed package version is checked against the reviewed lock. Runtime import/native-library tests run without network access.

The application remains on Node 22 and Vite 6. Drizzle Kit remains 0.31.11, moved to the root development manifest so its narrow core-utils override actually applies. Root esbuild is 0.25.12; tsx retains its compatible 0.28.2. A broad override broke Vite's target transformation during verification and was rejected. npm 11.17.0 is pinned consistently. No forced upgrade was used.

Actual runtime inspection found only `ip-address@10.7.3` among the six affected Node package names above; this exceeds the attached report's 10.3.1 fix. The other five names were absent. The image guard rejects all exact affected versions from this archive recursively. This is targeted regression evidence, not a substitute for a new comprehensive scanner report.

The AI image retains its pinned Python 3.12 base, applies distribution updates, installs the frozen dependency lock and removes installer tooling after installation. Dependency layers precede application source so subsequent source changes do not re-download the entire environment. Backup archives use an operator-only, networkless PostgreSQL-image utility, not an added network service.

The pinned official uv image supplies a temporary read-only build mount; uv is not retained in the runtime. Dependency caching follows the [official uv Docker guidance](https://docs.astral.sh/uv/guides/integration/docker/). Local verification reused the same frozen-lock cache from a prior successful build; a clean builder must still obtain the locked artifacts. This does not establish internet-independent installation or bypass the lock.

## Unfixed/upstream and release decisions

The old report marks util-linux CVE-2026-53613/76642/78408/78409/78410 and ncurses CVE-2025-69720 as affected; gzip CVE-2026-41992, libacl CVE-2026-54369, systemd CVE-2026-16742 and Perl CVE-2026-9538 as deferred; zlib CVE-2023-45853 as `will_not_fix`; and http-cache-semantics CVE-2026-93748 as affected. These are **not accepted risks or asserted current-image findings**. Removing unused components reduces reachability but does not prove complete clearance. Any retained HIGH/CRITICAL requires a current report and explicit owner/security decision; none has been silently accepted.

The pinned Trivy policy remains `HIGH,CRITICAL`, includes unfixed findings, exits 1, and scans app, AI and PostgreSQL independently even after a failure. There is no ignore file, severity reduction or successful fallback. Scan/database-download failures are BLOCKED, never PASS. Exact final build/scan results and remaining external gates are in [the verification report](phase16-final-verification.md). Remote CI must be rerun on the reviewed candidate before release; historical passing CodeQL jobs are not evidence for this diff.
