# Phase 11 verification — 9 October 2026

Historical phase record. Retained source paths, SDK dependencies and deployment instructions below
describe that phase only. Phase 12 intentionally retires disposable source data and legacy files;
see [the current reset report](./phase12-test-data-reset.md).
Removed files can be inspected at checkpoint tag `checkpoint/phase12-pre-test-reset-20261009`,
not reapplied as current setup or public access policies.

Implemented only the **fail-closed engineering structure**, not a clinically approved calculator.
No approved reference set, formulary or qualified-clinician-reviewed golden cases were found. All
recommendations and clinician confirmation remain disabled, even with development/demo flags.
No medical dose limits or replacement clinical multipliers were invented. Work stops after Phase 11.

## Command results

| Command                                                                           | Actual result                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial `git status --short`                                                      | Clean worktree; existing Phase 10 safety freeze present                                                                                                                                                           |
| `npm install --package-lock-only --ignore-scripts`                                | Exit 0; records the existing Zod 4.6.5 as an explicit domain dependency                                                                                                                                           |
| `npm install --workspace @dentalai/api --save-dev --save-exact fast-check@4.10.2` | Exit 0; two dev packages added (`fast-check` 4.10.2 and locked `pure-rand` 8.4.2)                                                                                                                                 |
| `npm run typecheck`                                                               | Exit 0                                                                                                                                                                                                            |
| `npm run lint`                                                                    | Exit 0 in final aggregate verification                                                                                                                                                                            |
| `npm run format:check`                                                            | Exit 0 in final aggregate verification; final documentation rechecked separately                                                                                                                                  |
| `npm test`                                                                        | Exit 0: 46 web + 70 API unit tests, 116 total                                                                                                                                                                     |
| `npm run test:db`                                                                 | Exit 0: 20 migration/constraint tests + 125 API integration tests; one existing real-S3 test skipped without endpoint credentials                                                                                 |
| Focused initial anesthesia integration run                                        | Exit 0, 6/6; final expanded 8-test suite subsequently passed in the full API integration collection                                                                                                               |
| `npm run db:snapshot --workspace @dentalai/database`                              | Exit 0; additive migration metadata 0008 generated without changing old snapshots                                                                                                                                 |
| `npm run verify`                                                                  | Initial editing run exit 1 on an unformatted test (corrected). Subsequent run passed typecheck/lint/format/tests, but exited 1 after Vite emitted the bundle and hit the Windows native assertion described below |
| Standalone final `npm run build` rerun                                            | Exit 0: shared packages, Vite production bundle and API TypeScript build                                                                                                                                          |
| Final `npm run typecheck --workspace @dentalai/api`                               | Exit 0, including the final contract regression test                                                                                                                                                              |
| `npm run test:e2e`                                                                | Exit 0, 3/3 existing appointment, billing and clinician/patient clinical-record flows                                                                                                                             |
| `npm run audit`                                                                   | Exit 0 at the existing high-severity gate; four moderate findings remain, no high/critical findings                                                                                                               |
| `node scripts/check-artifacts.mjs` and `git diff --check`                         | Exit 0; no dataset/model changes or whitespace errors                                                                                                                                                             |

The failed Vite invocation emitted all assets, then printed
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`
with lifecycle code `3221226505`. The subsequent identical root build command passed. Its underlying
native-process cause was not established; the failed invocation is not represented as a successful
aggregate `verify`. No production code or build checks were weakened to suppress it.

Remaining audit findings are the existing development-tool chain
`drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild`, advisory
GHSA-67mh-4wv8-2f99. No forced downgrade/upgrade was applied. Installation also reported existing
esbuild install-script approval warnings; approvals were not changed. Vite emits existing Zod/Rollup
annotation warnings. Remote GitHub Actions were not executed by this local task.

## Tests and deliberate behavior changes

- Eight domain/contract unit tests import the actual pure engine: missing data, complete-but-blocked
  data, smoking invariance, input immutability, physical unit conversions, underflow/overflow,
  malformed/ambiguous fields, deterministic extreme-value sweeps and honest OpenAPI status codes.
- Seeded `fast-check` properties run 2,000 arbitrary double/unit cases and 1,000 arbitrary malformed
  inputs. Randomness exists only in reproducible test generation, never clinical output. See the
  [property-testing documentation](https://fast-check.dev/docs/core-blocks/properties/).
- Eight PostgreSQL/API tests cover non-clinician/anonymous denial, cross-clinic dentists, strict
  browser-field rejection, active providers/revoked sessions, provenance, version history,
  concurrent numbering, immutable records, blocked confirmation, database numeric-output guards,
  audit rollback and safe database-error responses. Tests use fictional accounts and disposable
  databases, not live Supabase credentials.
- The legacy 12 calculator UI tests were replaced by the disabled-even-in-demo regression and the
  engine tests. The former positive expectation for an unsourced numeric dose is deliberately removed.
  Invalid-input coverage now runs against the sole production engine rather than a browser formula.
- Old Supabase anesthetic recommendation reads/inserts and all browser dose arithmetic are removed.
  Historical rows remain physically preserved and are not relabeled as clinically approved results.
- The clinical patient page now shows the themed unavailable notice and dentist-responsibility text.
  It does not expose clinical entry/recommendation controls while requirements are unapproved.

## Changed-file map

- Domain: `packages/domain/src/anesthesia.ts`, domain exports and package manifest.
- Contracts/client: `packages/contracts/src/anesthesia.ts`, contract exports/OpenAPI generator,
  `apps/web/src/lib/api-client.ts`.
- API: `apps/api/src/domains/anesthesia/{anesthesia.repository,anesthesia.routes}.ts`, API mounting,
  rejection audit integration, API dev dependency and root lockfile.
- Database: reviewed `0008_anesthesia_safety.sql`, journal/snapshot 0008 and migration-count tests.
  Legacy migrations/assessments are not rewritten or deleted.
- UI/tests: anesthetic component, clinical patient page, web freeze regression, API domain/contract
  and integration tests. Existing appointment/billing production code is unchanged.
- Documentation: README, clinical-validation notes, this report and the detailed approval register.

## Clinical blockers

Every clinical rule is still awaiting approval. The complete 16-category register is in
[anesthesia decision support](anesthesia-decision-support.md#every-clinical-rule-still-awaiting-approval):
references/formulary, drug and absolute limits, concentrations/cartridges/vasoconstrictors, proposed
dose/rounding, age/weight applicability, BP, allergies, pregnancy/lactation, medications/interactions,
organ/cardiovascular severity, smoking, other contraindications, cumulative exposure/mixed drugs,
warning/outcome policy, approval/release workflow and clinician-reviewed cases/clinical validation.

No clinical golden cases or clinical performance results were fabricated. No reference-set version is
claimed approved (`referenceSetVersion=null`). Actual dosing, successful confirmation, rejection of
an actual recommendation and a patient-portal recommendation projection are deliberately blocked.
Provide approved versioned references and reviewer sign-off before implementing any clinical constants.
