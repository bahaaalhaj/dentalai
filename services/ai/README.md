# DentalAI AI service

AI-assisted decision support requiring clinician confirmation; no clinical/regulatory authorization.
See [aligned SRS](../../docs/srs.md) and [final verification](../../docs/phase16-final-verification.md)
for current build/evaluation status. The private pilot overlay publishes no AI host port.

Private experimental YOLOv8 detect ONNX runtime; no artifact is bundled or downloaded. Missing,
incompatible or unapproved models return readiness 503, never substitute results. `/health` is
liveness; `/ready` is model readiness; `POST /v1/infer` accepts bounded image bytes and a server-only
bearer token. Do not expose the service to browsers or public networks.

Python 3.12+: install `uv==0.12.23` and ensure its executable is on PATH (or activate the existing test virtual environment containing uv on Windows), then `uv sync --project services/ai --frozen --extra test`
and `npm run test:ai`. The committed `uv.lock` pins transitive dependencies and hashes across platforms.
Activate `services/ai/.venv` before `npm run dev:ai`. Set `AI_SERVICE_TOKEN` (32+ characters) and
`AI_MODEL_MANIFEST` (external absolute path), then `npm run dev:ai`. Configure the API with the same
token, `AI_SERVICE_URL`, private storage and explicit `XRAY_INFERENCE_ENABLED=true`. No server secret
may use a `VITE_` prefix. Without these settings the module fails closed.

Compose AI profile: set `AI_MODEL_DIRECTORY` to an existing external directory with `manifest.json`
and its artifact. The mount is read-only and process non-root. The loopback port supports a local
host-based API only. Production must remove the published port and use a private API/AI network or
firewalled, authenticated private TLS transport.

Manifest fields: `artifact` (relative `.onnx` path), `modelName`, `modelVersion`, `artifactSha256`,
`classMap` (ordered names), `inputSize` (32–1280 divisible by 32), `confidenceThreshold`,
`iouThreshold`, `license` (reviewed evidence reference), `provenance` (training commit/dataset
manifest/dependency lock/export settings), `approvedForExperimentalUse: true`. The last field is
an operator review attestation, not clinical validation. Test fixtures load only in `AI_ENV=test`;
never configure that environment for deployment.

Only static FP32 `[1,3,S,S]` inputs and raw `[1,4+C,N]` YOLOv8 detection outputs without embedded NMS
are supported. Segmentation/end-to-end exports, YOLOv5 objectness and PyTorch pickle are rejected.
Custom/local functions, control flow, external unchecksummed weights and stochastic operators
(including random distributions and dropout) are rejected before execution.
RGB letterbox, normalization and class-aware deterministic NMS use `yolov8-onnx-v1`; boxes use original
pixel coordinates. Review preprocessing against the artifact's training/export configuration.
See [Ultralytics ONNX export](https://docs.ultralytics.com/integrations/onnx/).

Normal responses use `detections-v2`: at most 1,000 detections and 512 KiB, with no raw tensors or research artifacts. Model/version/class labels are bounded and the API verifies source checksum, class membership and image dimensions before publication. ONNX cancellation is cooperative (20-second execution deadline); post-processing checks a 25-second deadline and the API bounds transport to 30 seconds. These are engineering safeguards, not validated clinical performance. See [storage and recovery](../../docs/phase16-storage-and-recovery.md).

The production Docker build uses immutable Python/uv image digests, the frozen lock, distribution patches, a reusable dependency cache and a temporary installer mount. Installer tooling is absent from the resulting non-root image. Builds/scans still require approved artifact downloads/cache; no scanner or model-approval gate is bypassed.

The generated ONNX test graph computes scores from synthetic pixels through actual runtime execution.
Tolerances: score absolute `1e-6`, box pixels absolute `1e-4`; latency excluded. It is nonclinical,
forbidden outside tests, and does not demonstrate dental model accuracy. A reviewed dental artifact
needs its own immutable image fixtures and approved golden tolerances before release.

## Offline evaluation

The container candidate preserves CPython 3.12 and the frozen inference dependency lock
on a pinned non-root distroless C/C++ runtime. Only linked distribution libraries are
copied, together with their genuine Debian package records and available copyright
notices. Unused interactive terminal extensions and libuuid acceleration are omitted;
stdlib UUID generation retains its secure fallback. No shell or installer is provided.
Container-native imports and missing-model behavior must pass the runtime guard before
the unchanged High/Critical scanner gate. See the repository's Phase 16 remote follow-up
for verification blockers; local Python tests alone do not establish container clearance.

From this directory: `python -m app.evaluation <external-manifest.json> --threshold <validation-selected-value>`.
Manifest: `licenseEvidence`, `deidentificationReviewed: true`, `classMap`, and `images` with pseudonymous
`patientId`, `split` (`train`, `validation`, `test`), `sha256`, `truth` (`classId`, pixel `box`), and actual
held-out `predictions` (`classId`, pixel `box`, `score`). Patients and duplicate images cannot span
splits. Do not put names/identifiable records in manifests. Legacy directory splits do not prove
patient-level separation; trustworthy patient identifiers are required.

Reports define detection precision/recall at IoU 0.5, image-presence sensitivity/specificity,
image-presence Brier/ECE/calibration bins, confusion matrices with background, and 95% patient-cluster
bootstrap intervals (1000 replicates). Undefined metrics are null. The seed affects offline resampling,
never clinical findings. Select thresholds on validation data before testing. No 90% accuracy claim
or patient diagnostic accuracy is supported; clinical validation remains pending.
