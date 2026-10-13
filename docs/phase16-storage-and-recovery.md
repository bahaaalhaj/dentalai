# Private storage and imaging recovery

The browser has no bucket credentials. Uploads and content downloads require a verified session, session-selected tenant, dentist role and active provider, with tenant membership rechecked before publication/content delivery. Content is private/no-store. All mutations require the signed CSRF cookie, `x-csrf-token` and exact configured `Origin`; see the generated `/api/v1/contracts/v1` document.

## Storage configuration

S3 sends **no object ACL**. Production/staging requires HTTPS, Bucket Owner Enforced ownership, all four Block Public Access controls and non-public policy status. Anonymous/shared bucket ACL grants and wildcard Allow policies fail closed. Safe Deny policies (TLS or encryption enforcement) are accepted. Use least-privilege IAM scoped to the private bucket and required metadata APIs. The adapter's checks supplement, not replace, reviewed IAM/bucket policy.

`S3_ENCRYPTION=AES256` is the default SSE-S3 request; `aws:kms` requires `S3_KMS_KEY_ID` and reviewed KMS grants. Encryption/key management on the actual production provider remains an integration gate. `S3_ALLOW_INSECURE_LOCAL_DEVELOPMENT=true` permits only recognized local HTTP endpoints in non-hardened environments. `local-test-none` is an explicit **local test only** encryption option, necessary for MinIO without KMS. Never use it in production. Local MinIO can lack AWS ownership/BPA APIs; that narrowly scoped compatibility path still checks grants and policy, and is not AWS production clearance.

Metadata plus upload/download/delete share a bounded deadline (15 seconds by default, at most 30 seconds) and caller cancellation. Downloads are capped at 10 MiB and require exact length/checksum. Writes use non-guessable immutable tenant keys and conditional create. No clinical image deletion endpoint has been added. The adapter deletion primitive is not permission to delete clinical history.

## Compact inference contract

Normal results use `detections-v2`, at most 1,000 detections and 512 KiB. Boxes are source-image pixel coordinates, not normalized fractions: `[x,y,width,height]`, bounded by the permitted image dimensions. Scores are not calibrated probabilities. Results include model/version/checksums, class map, thresholds, latency and post-processing version. Run timestamps, image identity and draft/confirmed/rejected review state are in the enclosing history record. Raw tensors/candidates are not returned or newly stored. No private research artifact is created by this change.

New successful runs store bounded metadata once and normalized detections once, atomically. Deferred database validation requires the recorded count to match, and late inserts/updates/deletes cannot append unaudited findings. Existing old JSON stays unchanged; its API projection removes raw data without manufacturing findings. Migration 0010 must be deployed before the new reader/writer; an old binary cannot safely consume new metadata. There is no automatic down migration that discards history.

API inference calls time out at 30 seconds; ONNX runs request termination after 20 seconds and post-processing checks a 25-second deadline. The Python endpoint retains its lock until actual execution returns. ONNX termination is cooperative, not a hard process kill; container CPU/memory limits and supervision remain required. Missing, malformed, oversized, interrupted or unhealthy inference never produces substitute findings. See [ONNX cancellation API](https://onnxruntime.ai/docs/api/python/api_summary.html).

## Retry/reconciliation procedure

Upload/analysis callers send an `idempotency-key` UUID. The durable operation includes tenant, verified actor, patient and request provenance hash. Same completed key replays its image/run; mismatched actor/provenance is rejected. Pending/failed keys do not silently create duplicates. The UI retains keys for immediate retries, not across browser restarts; an operator must inspect history before manually starting a new logical operation after a restart.

Runs and operation reservations have two-minute leases; normal inference completes within that lease. No heartbeat extends a clinical run. A trusted operator can run:

```sh
npm run imaging:reconcile -- CLINIC_UUID ACTIVE_OWNER_USER_UUID "Documented recovery reason"
```

The command requires configured private storage and an active owner of the explicitly selected tenant. It does not expose a browser administrative endpoint. It locks the clinic, recovers up to 50 expired runs and 50 stale pending files per invocation, records audit events and checks a 30-second cancellation deadline before/after object IO and before commit. This is not a hard process wall-clock limit: the database pool separately bounds connection acquisition to 5 seconds and each query/statement to 15 seconds; preceding database work can exceed the application deadline before its next check. Interrupted runs become failed with no result. Only owned, age-eligible objects whose length and SHA-256 match registration may be published. Missing/ambiguous objects and their quota reservations remain retained for manual investigation, never deleted automatically. Repeated runs are safe; schedule per tenant only after operator review and alert routing are configured.

Real AWS/KMS integration remains a release blocker. A skipped external S3 test is named accordingly; it is not evidence of readiness.
