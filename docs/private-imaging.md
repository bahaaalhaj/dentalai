# Phase 10: private imaging and experimental inference

## Safety boundary

Engineering infrastructure, **not a clinically validated diagnostic product**. Model scores and
dentist confirmation do not establish system clinical validation. Do not use these experimental
modules for patient-care decisions. No approved model or eligible evaluation dataset was provided;
real dental inference remains unavailable by default. No accuracy claim is made. The randomized
browser analyzer remains permanently unavailable; anesthetic safety flags are unchanged.

## Private storage and integrity

Server-only storage is explicitly selected by `STORAGE_DRIVER` (`s3` by default).
`filesystem` requires absolute `PRIVATE_STORAGE_DIRECTORY`, outside web/build folders, protected by
OS access controls; immutable tenant UUID keys are accessed only through authenticated streaming.
There is no fallback between adapters. Vite's private-directory denylist also protects development
files/mail/credentials. Offline filesystem tests do not certify real S3 or storage encryption.

S3 configuration: `CLINICAL_STORAGE_ENABLED`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`,
`S3_SECRET_KEY`. The bucket must already exist, have no bucket policy or shared ACL, and remain
private. The adapter rejects policy-bearing buckets before reads/writes and uses private object
ACLs. Use a dedicated bucket and least-privilege service credential, not the MinIO root account.
Prohibit public policies through deployment controls and continuously monitor configuration.
Bucket administrators can bypass application guarantees. For AWS enforce Block Public Access.
Storage encryption, TLS, backup/retention and private console access need deployment review.

Only single-frame PNG/JPEG up to 10 MiB, 16–8192 pixels per dimension, and at most 32 megapixels
are accepted. Checks include MIME, magic bytes, dimensions and full decode. Re-encoding to PNG
discards EXIF/ancillary metadata and appended payloads; source and canonical hashes are retained.
This does not remove burned-in identifiers or establish training-data de-identification.
DICOM/TIFF/PDF/SVG, animation and remote image URLs are unsupported.

Clinic, patient ownership and uploader come from a live authenticated dentist membership.
Patients, owners, admins and receptionists cannot upload, analyze, review or stream images in this
phase. Reads are authenticated same-origin streams with no-store; no public or permanent URLs.
Cryptographic UUID object keys contain no names. Browser contracts contain no storage credentials.

Upload reservation and audit commit before object PUT. Only a subsequent transaction publishes
the file. Failures leave a durable pending registration owning any private object. Reconcile it;
do not assume success or purge the row. No deletion endpoint exists. Versions, reviews, detections
and terminal runs are immutable; clinical object registration deletion is blocked. Future approved
retention must record deletion intent, delete the object, and retain an audited tombstone.

## API

All endpoints require a session cookie and tenant authorization; mutations also require CSRF.

| Method | Path                                   | Input / behavior                                                                                  |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/imaging/patients/{id}`        | Tenant image/run history                                                                          |
| POST   | `/api/v1/imaging/patients/{id}/images` | Raw PNG/JPEG; percent-encoded `x-imaging-reason`; optional UUID `studyId` query appends a version |
| GET    | `/api/v1/imaging/images/{id}/content`  | Authorized private stream                                                                         |
| POST   | `/api/v1/imaging/images/{id}/analyses` | `{ reason }`; append actual run or persist safe failure                                           |
| POST   | `/api/v1/imaging/analyses/{id}/review` | `{ decision: "confirmed"                                                                          | "rejected", reason }` |

Review is a single terminal decision under a row lock. Corrections need a new run/review, never
erasure. Normalized model detections do not automatically become odontogram clinical truth.
Successful runs preserve model name/version/checksum/class map, thresholds, latency, input hash,
raw/processed detections and postprocessing version. Failed runs store a safe code, no findings.
Abandoned running jobs after a process crash require operator reconciliation with an audited failed
transition; there is no automatic background inference retry.

## Migration and recovery

`0007_private_imaging.sql` is additive and preserves historical records. Review SQL, back up DB
and storage together, migrate and test staging restore. Reviewed SQL is authoritative for checks/
triggers; ORM metadata describes tables. There is no destructive down migration. Rolling back code
leaves history intact; never restore an older DB while silently losing newer object registrations.
The approved Phase 12 test-data reset imports no legacy objects/results. Its fictional study is
metadata only; no image acquisition or findings are invented. See [the reset report](phase12-test-data-reset.md).

## Pending validation / deployment gates

- Reviewed dental YOLOv8 ONNX artifact, license, class taxonomy, provenance and golden-image test.
- Dataset license/consent, de-identification and trustworthy patient-level split manifest.
- Actual holdout metrics, calibration, chosen thresholds and independent clinical validation.
- Storage encryption, access-policy enforcement, restore test and retention sign-off.
- Reachable private S3-compatible server for the real adapter integration test. The configured
  MinIO Docker Hub pull failed with access denied; Quay also returned 401 in this environment.
  Injected storage tests are not real MinIO integration verification.

No valuable dataset, run output or weight was deleted or moved without a verified destination.
