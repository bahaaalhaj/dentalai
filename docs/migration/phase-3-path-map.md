# Phase 3 path migration map

Historical phase record. Retained source paths, SDK dependencies and deployment instructions below
describe that phase only. Phase 12 intentionally retires disposable source data and legacy files;
see [the current reset report](../phase12-test-data-reset.md).
Removed files can be inspected at checkpoint tag `checkpoint/phase12-pre-test-reset-20261009`,
not reapplied as current setup or public access policies.

| Previous path                                               | Phase 3 path                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/`                                                      | `apps/web/src/`                                                                         |
| `public/`                                                   | `apps/web/public/`                                                                      |
| `index.html`                                                | `apps/web/index.html`                                                                   |
| `vite.config.ts`                                            | `apps/web/vite.config.ts`                                                               |
| `vitest.config.ts`                                          | `apps/web/vitest.config.ts`                                                             |
| `server.ts`                                                 | `apps/api/src/server.ts`                                                                |
| `src/components/ErrorBoundary.tsx`                          | `packages/ui/src/ErrorBoundary.tsx`                                                     |
| `src/components/LoadingScreen.tsx`                          | `packages/ui/src/LoadingScreen.tsx`                                                     |
| Clinical feature-gating rules in `src/lib/feature-flags.ts` | `packages/domain/src/clinical-features.ts`; the web file remains an environment adapter |
| `database_schema.sql`                                       | `infra/supabase/database_schema.sql`                                                    |
| `CLINICAL_SAFETY.md`                                        | `docs/clinical-validation.md`                                                           |
| `ML_ARTIFACT_MIGRATION.md`                                  | `docs/ml-artifact-migration.md`                                                         |

The datasets, training scripts, run outputs, and model weights remain at their previous paths pending the
separate artifact migration proposal. Phase 3 does not migrate application data or authentication.
