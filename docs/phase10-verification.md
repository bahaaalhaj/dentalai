# Phase 10 verification and release status

Historical phase record. Retained source paths, SDK dependencies and deployment instructions below
describe that phase only. Phase 12 intentionally retires disposable source data and legacy files;
see [the current reset report](./phase12-test-data-reset.md).
Removed files can be inspected at checkpoint tag `checkpoint/phase12-pre-test-reset-20261009`,
not reapplied as current setup or public access policies.

Phase 10 engineering implementation is present. It is **not clinically validated or ready for
patient-care decisions**. Actual private-storage integration and a real dental-artifact golden test
remain blocked; no clinical model accuracy or dataset licensing verification is claimed.

## Implemented

- Private storage adapter, authenticated streams, cryptographic keys, checksum verification,
  MIME/magic/full-decode/dimension/size checks and explicit APNG rejection.
- Durable pending object registration before PUT; append-only image versions and analysis/review
  history. No clinical image deletion endpoint or browser/public Supabase storage fallback.
- Live clinic/session/role checks, active staff/provider checks and dentist-only review, including
  database review guards. Concurrent review permits one terminal decision, never silent correction.
- Private FastAPI YOLOv8 ONNX runtime with manifest/version/checksum/class-map/threshold validation,
  actual CPU execution, deterministic postprocessing and fail-closed model readiness. Stochastic
  operators, local functions, custom/control-flow exports and external weights are rejected.
- Actual raw predictions, normalized model observations, processing version, latency, errors,
  input/artifact checksums and review states. Observations are not automatically clinical truth.
- Experimental imaging page, server configuration capabilities, typed client and clear unavailable
  states. Changing patient clears the selected upload. Upload time is not fabricated acquisition
  time: unclassified studies retain the initial schema state and an explicit unknown-time note.
- Frozen Python dependency lock, CI inference tests and an artifact gate. Training/conversion
  require external paths; existing datasets, runs and weights remain untouched.

## Commands executed

| Command                                                                                       | Observed result                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install --workspace @dentalai/api --save-exact sharp@0.35.5 @aws-sdk/client-s3@3.1148.0` | Exit 0; 29 packages added; no forced upgrade                                                                                                                                             |
| `npm run verify`                                                                              | Exit 0: workspace typecheck, lint, formatting, 57 web + 62 API unit tests, web/API build and high-severity audit gate                                                                    |
| Final web/API workspace typecheck and build reruns                                            | Exit 0 following the final imaging changes                                                                                                                                               |
| Final `npm run lint` and `npm run format:check`                                               | Exit 0                                                                                                                                                                                   |
| `npm run test:db` with disposable PostgreSQL                                                  | Exit 0: 20 migration/constraint + 115 API integration tests; one real-S3 test explicitly skipped without a test endpoint                                                                 |
| Focused imaging integration reruns                                                            | Exit 0: final expanded suite 8/8 on a clean disposable database, including cross-clinic dentists and inactive-provider denial                                                            |
| Final web/API unit reruns                                                                     | Exit 0: 57 web and 62 API tests                                                                                                                                                          |
| `npm run test:ai` using frozen `uv.lock`                                                      | Exit 0: final 10/10 tests, including actual ONNX fixture execution and stochastic-artifact rejection                                                                                     |
| `uv lock --project services/ai --check`                                                       | Exit 0; 37 resolved packages                                                                                                                                                             |
| `npm run test:e2e`                                                                            | Final exit 0, 3/3 appointment, clinical and billing flows. Two earlier billing runs hit the existing 60-second timeout; final suite passed without modifying billing code or its timeout |
| `npm audit --json`                                                                            | Exit 1: 4 moderate findings; 0 high/critical                                                                                                                                             |
| `npm run audit`                                                                               | Exit 0 at the existing high-severity gate                                                                                                                                                |
| `node scripts/check-artifacts.mjs`                                                            | Exit 0 for changed tracked source files; no dataset/model changes                                                                                                                        |
| Configured MinIO Docker Hub pull / Quay attempt                                               | Access denied / HTTP 401; no real-storage success is claimed                                                                                                                             |

The final provider/review and random-operator regression tests were added after the full-suite
collections; focused reruns verify those additions. Remote GitHub Actions were configured, not
executed by this local task. Earlier in-progress formatting/build failures were corrected; no
passing result is inferred from a failed invocation.

Remaining audit findings are the existing Drizzle Kit development chain:
`drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild`.
No unreviewed forced downgrade/upgrade was applied. Build emits existing Zod/Rollup annotation
warnings; Python tests emit one Starlette/httpx test-client deprecation warning.

## Test coverage and its limits

New tests use production API/repository/decoder code, fictional clinic/patient accounts and temporary
PostgreSQL databases. They cover anonymous/non-dentist/cross-clinic/inactive-provider denial;
malformed, oversized, forged, truncated and animated uploads; immutable versions; private streams;
failed/missing inference; retained pending registrations; and concurrent terminal reviews.

Python tests execute ONNX Runtime on a generated **nonclinical pipeline graph** using synthetic
pixels. Documented absolute tolerances are score `1e-6` and box coordinates `1e-4` pixels, excluding
latency. This does not substitute for a golden inference test of an approved dental YOLO artifact.
Evaluation tests verify patient/duplicate-image separation, licensing review gates, defined and
undefined metrics, patient bootstrap intervals and calibration-bin boundaries.

The real S3 adapter test checks authenticated round-trip, anonymous denial and public-policy refusal,
but requires `TEST_S3_ENDPOINT`, `TEST_S3_ACCESS_KEY`, `TEST_S3_SECRET_KEY`. It was skipped because no
reachable approved disposable server was available. Injected storage fixtures are not evidence of
actual MinIO compatibility or deployment security.

## Release blockers / pending clinical validation

1. Supply an accessible approved private S3-compatible deployment, verify the real adapter test,
   account/bucket public-access prevention, TLS/encryption, backups and restore/retention policy.
2. Supply a reviewed versioned dental YOLOv8 ONNX artifact, model license/provenance and golden
   fixture images. Existing unreviewed PyTorch weights were not loaded or exported.
3. Establish dataset source rights, consent/de-identification and reliable patient-level splits.
   Legacy directory splits and training-run outputs do not prove those properties.
4. Produce actual held-out per-class precision/recall, defined sensitivity/specificity, calibration,
   confusion matrices and patient-level confidence intervals. The harness exists; measured dental
   results do not. No 90% accuracy claim is supported.
5. Complete independent clinical validation before any patient-care use. Dentist confirmation is
   record review, not system validation.
6. Existing Supabase images/reports remain physically preserved, not privately imported or approved
   as clinical truth. Operator-authorized access, identity mapping, a verified private destination
   and revocation of any old public access are needed; no deletion or external policy change was
   attempted without those inputs.
7. Pending uploads and abandoned running requests need audited operator reconciliation. No automatic
   retention/deletion/retry worker is implemented or claimed in this phase.

See [private imaging](private-imaging.md), [runtime/evaluation setup](../services/ai/README.md), and
[ML artifact migration proposal](ml-artifact-migration.md). Work stops after Phase 10.
