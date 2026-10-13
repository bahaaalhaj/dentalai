# Phase 13 verification

Historical Phase 13 run evidence. Current requirements/results are [SRS](srs.md) and
[Phase 15](phase15-final-verification.md). Administrative subscription state is not payment evidence.

Administration/productization only; no deployment/later phase. Initial worktree was clean
at `f5fc069` (`commit12`). Existing clinical gates/reset inspected; no user edits overwritten,
dependencies changed, clinical constants invented or model artifacts deleted.
Baseline `npm test`: exit 0, 44 web and 77 API unit tests.

Verification uses disposable PostgreSQL 17.11 on loopback 55437, per-suite UUID databases,
and synthetic PNGs in private temporary storage. Existing local DB/unrelated containers
are not reset. Additive migrations were applied locally and repeated seeding succeeded.

## Recorded command results

| Command                                                   | Result                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline `npm test`                                       | Exit 0: 44 web + 77 API unit tests.                                                                                                                                                                                                                        |
| `npm run verify`                                          | Exit 0: workspace typechecks, lint, extraction, formatting, unit tests, build and audit threshold. That run had 48 web + 85 API units; the final locale regression below adds one web test.                                                                |
| Final web `typecheck`, `test`, `build` workspace commands | Exit 0: 49 web tests, including locale changes after membership selection; production Vite build passes.                                                                                                                                                   |
| `npm run test:db`                                         | Exit 0: 20 migration/constraint tests and 146 API integration tests; 1 existing optional S3 test skipped without `TEST_S3_ENDPOINT`/credentials. Private filesystem authorization/export is tested against actual temporary storage.                       |
| `npm run test:e2e`                                        | Exit 0: 5 real-browser flows; English/Arabic mobile administration/onboarding, booking/confirmation, approved clinical history, invoice/payment/refund and offline private imaging.                                                                        |
| `npm run dev:seed` (twice)                                | Both exit 0: migrations + idempotent synthetic fixtures, no legacy import/reset or currency conversion.                                                                                                                                                    |
| `npm start`, `npm run smoke:local`                        | Built local application starts on loopback; smoke exits 0 for all six synthetic accounts/five roles, including owner/admin administration and every member's notification preferences.                                                                     |
| `npm run test:ai`                                         | Local `uv` command unavailable on PATH. No Python/inference code changed. Existing `services/ai/.venv/Scripts/python.exe -m pytest services/ai/tests -q` exits 0: 10 tests, one upstream Starlette deprecation warning. CI installs its pinned uv runtime. |
| `npm run audit`                                           | Exit 0 at high threshold; four existing moderate findings, zero high/critical. No forced upgrade/dependency change.                                                                                                                                        |
| Gitleaks 8.30.1                                           | Exit 0 for all 12 committed-history revisions, tracked diff and nonignored new files, using redaction and no network.                                                                                                                                      |
| `git diff --check`, artifact gate                         | Exit 0; no new large model/dataset artifacts, existing ML content preserved.                                                                                                                                                                               |

Final lint/extraction/format checks were repeated after the locale and smoke-tool changes.
The final locale/guard focus run passed all four tests, including retained user language
preference across clinic switches; the rebuilt administration browser focus run passed.
The temporary smoke API and disposable test container were stopped/removed after verification.
The existing healthy named-volume local PostgreSQL and unrelated containers remain intact.
Audit chain remains `drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils -> esbuild`
(GHSA-67mh-4wv8-2f99). The high/critical gate passing is not a zero-finding audit.
Vite reports the existing two third-party Zod annotation warnings, not build errors.
Earlier working runs caught an invitation SQL parameter-cast defect, quota replacement
edge cases and formatting issues; corrected implementation/regression suites pass.
Secret scanning initially flagged adjacent checksum translation IDs near UI password labels;
unused technical inventory was removed and exact nonsecret UI entries annotated, not
authentication/configuration files broadly exempted.

No Supabase occurrence remains in application/packages/infra/env example/manifests; the
historical reset documentation remains intentional. Searches found no randomized clinical
output or newly asserted clinical validation. Remote GitHub Actions were not executed from
this uncommitted worktree; their relevant commands were exercised locally.

Added coverage uses production contracts/pure policy/repositories/migrations/outbox and
PostgreSQL, not duplicate calculators: isolated onboarding, verified/stale sessions,
roles/cross-clinic denials, concurrent quotas, private storage/export, versions, role changes,
trial/grace/expiry, notification encryption/transaction rollback/preferences/retry exhaustion,
export checksums and retained offboarding. Browser tests cover English/Arabic mobile layouts
and guided onboarding alongside existing appointment/clinical/billing/private-imaging flows.

Changes: API admin/notification domains, additive SQL/schema/metadata, safe contracts/domain
policy, web admin/i18n, existing transaction locking/invitation/outbox/client/account/routes,
shared UI messages, development configuration, commands and CI. Clinical formulas/model/
reference gates/history remain unchanged; extracted strings/logical spacing preserve the theme.

Pending release gates: reviewed real billing provider, professional Arabic medical wording,
legal ownership/retention/erasure policy, owner transfer/recovery, SMTP deliverability/duplicate
handling/key rotation, operator large-clinic streaming export, backup/restore/security review,
approved model and anesthesia references. No clinical or production validation is claimed.
