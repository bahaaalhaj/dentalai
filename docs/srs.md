# DentalAI: aligned software requirements specification

Version: Phase 15, 2026-10-13. Implementation baseline: `84b9d16` (Phase 14).
This is the current repository specification, not clinical/regulatory authorization.

## 1. Source and interpretation

Reviewed source: **DentalAi-SRS.pdf**, dated 15/3/2026, 23 pages, supplied by the
operator outside the repository. SHA-256:
`096f2f8479a46cb7af2291ff3338ec27c596bae4e0cee7961115300a17fbb49d`.
The source is preserved unchanged; this Markdown supersedes its present-tense
implementation claims. Page references below are physical PDF pages, not section numbers.
The PDF has no stable requirement IDs. IDs introduced here remain stable: do not
renumber them when a requirement is retired; record a superseding ID instead.

Status **implemented** means code and applicable local tests exist; it does not
mean deployed, operationally qualified or clinically approved. **Partial** identifies
a implemented subset; **blocked** identifies missing evidence/approval/infrastructure;
**future** identifies an unimplemented source feature, not a commitment to add it.
Exact final test results are in [Phase 15 verification](phase15-final-verification.md);
[traceability](requirements-traceability.md) binds these IDs to production code and tests.

## 2. Purpose, scope and terminology

DentalAI is a web-based, tenant-scoped clinic-management application: accounts,
scheduling, versioned clinical records, explicit odontogram workflows, financial
ledger, private images and clinic administration. Experimental clinical modules are
**AI-assisted decision support requiring clinician confirmation**, not autonomous
diagnosis, approval of a treatment, or prescribing. Anesthesia is a separate
transparent **rule-based** decision-support engine, not a second AI model.
Both experimental modules must not be used for patient-care decisions in this release.

Definitions: clinic = tenant; membership = one user's privileges in one clinic;
patient = clinical entity distinct from a portal user; approval = recorded clinician
decision, not system validation; issued invoice = immutable financial snapshot;
payment/refund = recorded ledger evidence, not proof of external fund settlement.
Bibliographic medical books in the original PDF are not an approved, versioned dose
reference set or clinician-reviewed golden cases.

## 3. System, deployment and trust model

```text
Browser: React 18 / Vite + safe Zod contracts
  -> same-origin HTTPS edge (operator-provisioned)
  -> Express /api/v1 modular monolith + in-process PostgreSQL outbox worker
     -> self-hosted PostgreSQL / reviewed Drizzle SQL migrations
     -> explicitly selected private filesystem OR S3-compatible storage
     -> authenticated private FastAPI / ONNX inference, only when enabled/configured
     -> configured SMTP; private mailbox only for development/test
Operator: separate migration identity, secret mounts, encrypted backup/recovery tools
```

The browser never connects to PostgreSQL, private object storage, or FastAPI directly.
The API serves built web assets in production and mounts Vite only in development.
Applications share transport schemas/domain rules, not database credentials/models
with the browser. The AI service has no PostgreSQL login or public pilot port; the
API owns persistence and review. ONNX Runtime is the inference backend; retained
PyTorch/YOLO training tooling is not a shipped diagnostic model. The landing animation
uses locally bundled Lottie/WASM; the current odontogram is a 2D explicit workflow,
not the source's claimed Three.js clinical model.

Development, test, staging and production configuration are validated separately;
staging uses production runtime rules. The pilot is one host/one API replica with
private named volumes, non-root/read-only app container, restricted runtime DB role,
operator TLS reverse proxy and a separate migration identity. Production configuration
does not provision certificates, encrypted disks or off-host custody automatically.
No default production passwords, Redis, Kubernetes or message broker are provided.

Trust boundaries include browser-to-API identity/CSRF/input, API-to-tenant database
authorization, API-to-private files, API-to-AI token/model provenance, SMTP disclosure,
and privileged operator/backup custody. See [architecture](architecture.md),
[scoped threat model/ASVS](phase14-threat-model.md) and [security](security.md).
Threats include cross-tenant IDOR, account takeover, malicious uploads, inference
abuse, audit tampering and stolen backups. DB/host administrators remain privileged;
append-only tables are not tamper-proof against those administrators.

## 4. Tenancy and final role model

Global identities (`users`, auth credentials, pre-clinic sessions/security events)
are not clinic-owned; global plan catalog rows are also deliberate exceptions.
Tenant-owned records carry `clinic_id` and composite tenant foreign keys. The server
derives tenant and privileges from an active membership on every protected request;
browser IDs are selectors only, never trusted authority. A user may hold multiple
memberships/roles. Public registration creates only an unprivileged patient account,
not a clinic membership or linked patient record. Verified clinic onboarding may
create a new isolated clinic and its owner; it cannot grant access to an existing clinic.

| Role key       | Current authority                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clinic_owner` | Clinic administration, staff management, scheduling, pricing/finance; fresh-session export/offboarding and owner audit/usage summaries                         |
| `clinic_admin` | Clinic configuration/invitations/scheduling/finance, but no owner-only export/offboarding/subscription grants or peer-admin promotion                          |
| `dentist`      | Assigned-provider calendar; clinical records, private image upload/review and blocked anesthesia assessments only with an active provider; financial read-only |
| `receptionist` | Clinic scheduling and invoice/payment operations; no clinical authoring/image review, pricing/refunds or start/complete appointment authority                  |
| `patient`      | Explicitly linked own appointments, approved clinical projection and issued invoices/receipts; no clinician writes or experimental-module access               |

An owner is not implicitly a dentist. Clinic selection proves membership ownership.
Patient linkage is explicit, not inferred from email. New patient creation/linking
and owner transfer/recovery require reviewed operator workflows; there is no general
patient-creation or search API in the current clinical UI. Application checks and
SQL constraints enforce isolation; PostgreSQL per-tenant RLS is **not implemented**.

## 5. Functional requirements

| ID          | Verified requirement / boundary                                                                                      | Status                       | Original PDF                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------- |
| FR-AUTH-001 | Strict patient-only public registration and verified email/password login using maintained server-side auth          | Implemented                  | 7, 17                                                         |
| FR-AUTH-002 | Opaque server sessions, fixation prevention, restoration, expiry, logout, session list/revocation and password reset | Implemented                  | 13, 17                                                        |
| FR-TEN-001  | Server-derived active clinic membership and five-role authorization; deny foreign resources and other patients       | Implemented                  | 15, 20, 23; replaces two-role/RLS-only model                  |
| FR-ADM-001  | Guided isolated-clinic onboarding, configuration and owner dashboard                                                 | Implemented                  | 10-11, 16; multi-clinic now implemented                       |
| FR-ADM-002  | Administrative staff invitations and authorized membership/role/status changes                                       | Implemented                  | Extends registration/access requirements                      |
| FR-ADM-003  | Plan catalog, administrative subscription lifecycle/grace and DB-enforced capacity limits without fabricated payment | Implemented                  | New administrative domain from completed Phase 13             |
| FR-SCH-001  | Location timezone, chairs, types/durations, hours, closures and anonymized authenticated availability                | Implemented                  | 10-11, 17-18                                                  |
| FR-SCH-002  | Atomic booking, PostgreSQL collision prevention and exactly one winner for conflicting concurrent bookings           | Implemented                  | 13, 17-18                                                     |
| FR-SCH-003  | Authorized confirm/reschedule/cancel/no-show/check-in/start/complete; retained historical row and audit              | Implemented                  | 7-8, 10-11, 17-20                                             |
| FR-CLI-001  | Existing patient directory and explicit, versioned demographic/risk/allergy/medication records                       | Partial                      | 7-8, 11, 18; no text search/general patient creation          |
| FR-CLI-002  | Encounters, authored/timestamped notes, explicit review and append-only corrections                                  | Implemented                  | 7-8, 19-22                                                    |
| FR-CLI-003  | Explicit FDI tooth/surface findings, procedures and normalized treatment-plan items; reconstruct prior encounter     | Implemented                  | 17, 20; replaces 1-32 click cycling                           |
| FR-CLI-004  | Patient portal exposes only linked approved clinical information, read-only                                          | Implemented                  | 7, 13, 20, 22                                                 |
| FR-BIL-001  | Published services/prices and draft/issued immutable invoice snapshots with optional approved clinical links         | Implemented                  | 9, 18-19; replaces Stripe assumption                          |
| FR-BIL-002  | Integer-minor-unit payments/refunds/adjustments, idempotent receipts, immutable balances and issued-invoice reports  | Implemented                  | 18-19; no chart-derived historical cost or funds transfer     |
| FR-BIL-003  | Linked patient-only issued invoice/receipt projection                                                                | Implemented                  | Extends patient portal                                        |
| FR-IMG-001  | Validated private PNG/JPEG upload, checksum/provenance/version history and authorized streams                        | Implemented                  | 9-10, 17                                                      |
| FR-AI-001   | Private real versioned ONNX inference; safe unavailable/error, stored model provenance and immutable dentist review  | Partial                      | 6-7, 17; engine structure tested but dental artifact absent   |
| FR-AI-002   | Clinically evaluated dental findings and measured performance, with clinician confirmation                           | Blocked                      | 18, 22; no eligible artifact/dataset/evaluation or validation |
| FR-ANE-001  | One pure versioned engine, validated explicit inputs, blocked outcomes, trusted persistence/audit                    | Implemented safety structure | 7, 14, 17, 22                                                 |
| FR-ANE-002  | Approved formulary/dose rules, transparent numeric limits and clinician confirmation                                 | Blocked                      | 17, 22; no approved references/golden cases                   |
| FR-AUD-001  | Tenant/actor/time/reason and before/after audit with atomic mutations and immutable clinical/financial history       | Implemented                  | 13, 20-22; fills omitted audit section                        |
| FR-NOT-001  | Real provider abstraction, transactional invitation outbox, preference/history, bounded retries                      | Implemented                  | 6, 9, 11, 15; current provider is email, not WhatsApp         |
| FR-EXP-001  | Fresh-owner tenant export/private-file download and non-destructive offboarding                                      | Implemented                  | Extends data ownership; not automatic erasure or backup       |
| FR-I18N-001 | English/Arabic interface layer and RTL; clinical terminology remains reviewable English                              | Partial                      | 10, 16; no approved medical Arabic translation                |
| FR-REC-001  | Quiesced encrypted PostgreSQL/private-filesystem backup, authenticated clean restore and reconciliation              | Implemented local tools      | 19; installed off-host automation remains blocked             |
| FR-FUT-001  | Twilio/WhatsApp/SMS appointment reminders, Stripe charges/webhooks, DICOM/PACS                                       | Future                       | 3-6, 9-11, 15                                                 |
| FR-FUT-002  | IndexedDB offline clinical sync, mobile apps, OAuth login, treatment-distribution and monthly revenue charts         | Future                       | 7-9, 16, 18, 22                                               |

## 6. Use-case summaries

| Use case                       | Actor / precondition                            | Main success path                                                                                  | Failure / safety path                                                                            | Requirement IDs                      |
| ------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| UC-01 Account access           | Registered or new user                          | Register, verify email, sign in; select own membership                                             | Injection/CSRF, unverified account, expired/revoked session denied; no role fallback             | FR-AUTH-001, FR-AUTH-002, FR-TEN-001 |
| UC-02 Clinic setup             | Verified user attests authority                 | Create isolated clinic, owner configures location/hours/services, invites staff                    | Attestation is not legal verification; never join an existing tenant by supplied ID              | FR-ADM-001, FR-ADM-002               |
| UC-03 Patient booking          | Active linked patient membership                | Obtain anonymous offer, book atomically, refresh upcoming/history                                  | Offer is not reservation; collision/stale token yields conflict, no deletion                     | FR-SCH-001, FR-SCH-002               |
| UC-04 Staff calendar           | Permitted staff / assigned dentist              | Confirm/reschedule/transition with revision and reason                                             | Wrong tenant/role/time/terminal state rejected; audit commits with change                        | FR-SCH-003                           |
| UC-05 Clinical visit           | Dentist with active provider; existing patient  | Start visit, select explicit tooth action/surfaces, save draft, review, correct by successor       | Invalid FDI/surface, stale revision, missing reason, closed visit or patient write rejected      | FR-CLI-001, FR-CLI-002, FR-CLI-003   |
| UC-06 Patient history          | Explicit portal link                            | Read approved chronological records/odontogram                                                     | Draft/rejected/foreign information excluded; refresh, not realtime push                          | FR-CLI-004                           |
| UC-07 Financial record         | Authorized billing staff                        | Issue price snapshot, record payment; authorized admin refunds/adjusts                             | Invalid money/overpayment/stale or unaudited change rejected; no external funds moved            | FR-BIL-001, FR-BIL-002, FR-BIL-003   |
| UC-08 Private image            | Active dentist                                  | Upload canonical private file; configured model may produce draft run; dentist confirms/rejects    | Malicious file/foreign tenant rejected; missing model unavailable, never synthetic findings      | FR-IMG-001, FR-AI-001, FR-AI-002     |
| UC-09 Anesthesia review        | Authorized dentist                              | Store validated input provenance and versioned blocked outcome                                     | No numeric recommendation/confirmation while approved references absent                          | FR-ANE-001, FR-ANE-002               |
| UC-10 Owner export/offboarding | Fresh owner session                             | Export tenant JSON and separately download private files, acknowledge offboarding                  | Limits/foreign tenant/stale sign-in denied; retain clinical/financial/object history             | FR-EXP-001                           |
| UC-11 Recovery                 | Privileged operator, separate empty environment | Quiesce, encrypt DB/objects/manifest, authenticate restore, reconcile, revoke sessions, smoke test | Wrong key, altered archive, unsafe paths or nonempty destination refused; keep failures isolated | FR-REC-001                           |

## 7. Data model and integrity

UUID tenant keys/composite FKs connect clinics, locations, operatories, memberships,
staff/providers and clinical patients. Appointments use timezone-aware instants plus
explicit IANA timezone, half-open resource reservations and append-only transition
history. Encounter/clinical revision/approval headers connect normalized demographic,
alert/allergy/medication, note, finding/surface, procedure and plan-item payloads.
FDI permanent quadrants 1-4/positions 1-8 and primary quadrants 5-8/positions 1-5
are supported by validation and displayed in the current chart. Unrecorded
teeth are not automatically healthy. Correction retains prior content/publication.

Files/studies/image versions connect immutable inference runs, normalized detections
and terminal clinician review. Money uses integer minor units and explicit currency;
invoice snapshots and signed immutable ledger events determine balances, not current
tooth state. Notification payloads are encrypted; outbox stores delivery IDs.
See [full schema](database-schema.md) for tables, checks, indexes and deletion behavior.
The approved development reset uses tenant `10000000-0000-4000-8000-000000000001`,
SYP synthetic values 1:1; no currency conversion or legacy-data migration occurred.

## 8. Nonfunctional requirements: targets versus evidence

| ID           | Original target                                         | Verified position / status                                                                                                                                            |
| ------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-SEC-001  | Secure auth, RBAC, safe validation and errors           | Implemented local defenses/tests; MFA/common-password blocking absent; independent pentest blocked                                                                    |
| NFR-SEC-002  | TLS 1.3 and blanket AES-256 database encryption         | Unsupported deployment claim removed. HTTPS/SMTP validation and specific AES-256-GCM backup/notification envelopes exist; DB/disks/TLS edge need provisioned evidence |
| NFR-SEC-003  | Every request protected by RLS; immutable audit         | Live server membership/resource checks + tenant FKs/SQL guards, not RLS. Restricted pilot DB role rejects audit mutations; administrators remain privileged           |
| NFR-PERF-001 | Login/booking <=2s, records <=3s, 20 users              | Only bounded workstation regression measured (Phase 14 login p95 420ms, booking 503ms, records 225ms); 20-user/sustained/VPS qualification not done                   |
| NFR-PERF-002 | Dental inference <=5s, 90% accuracy                     | Blocked: no eligible artifact or measured holdout; no diagnostic/accuracy or inference SLA claim                                                                      |
| NFR-REL-001  | 99% / 99.9%, MTBF 3,000h, MTTR <30min                   | Conflicting source targets unqualified; no uptime history or measured reliability guarantee                                                                           |
| NFR-REC-001  | Recoverable backups/automatic saving                    | Local encrypted restore drill; explicit committed saves, not offline autosave. RPO24h/RTO4h proposals and timer not deployed/qualified                                |
| NFR-RET-001  | Seven-year clinical/two-year audit retention, PII purge | No jurisdiction-approved policy or purge process. History/offboarding retain data; proposed backup/log retention is not legal compliance                              |
| NFR-MNT-001  | Every component <=400 lines                             | Not met: AppointmentsPage.tsx 918 physical lines. No refactor during final verification; repositories/client also large. Future split must preserve tested behavior   |
| NFR-TYP-001  | 100% TypeScript with strict null checks                 | TS workspaces use strict + additional checks; Python inference/SQL/mjs tools intentionally not TypeScript. skipLibCheck remains true; percentage claim removed        |
| NFR-PORT-001 | Identical Chrome/Safari/Edge, all OS                    | Chromium desktop tested locally; Safari/Firefox/Edge branded and iOS/Android/macOS not qualified. Linux Node22 configured in CI, not a claim of remote CI execution   |
| NFR-UX-001   | Desktop/tablet, 60FPS, specified heap/VRAM/cache        | Source device/RAM/60FPS/heap/network minima not benchmarked. Six automated axe scans and bilingual smoke are partial; manual keyboard/AT/tablet review pending        |

No 0% mathematical-error claim: tests exercise representation/units/invalid/extreme
inputs; approved medical golden cases are absent and numeric dose output is disabled.
No support/availability guarantee is inferred from cloud vendors or libraries.

## 9. External interfaces, operations and future scope

HTTP/JSON via generated `/api/v1/contracts/v1?format=openapi`; authenticated raw image
upload/stream; PostgreSQL wire protocol server-only; configured SMTP; private binary
FastAPI inference. No WSS/WebSockets/SSE or automatic realtime sync. Views refresh
deliberately after actions or manually. No special hardware handshake/device driver,
File System Access API dependency, PACS integration or image-acquisition device exists.
These statements replace the source's omitted interface/handshake/audit sections.

SMTP acceptance is not inbox delivery; retries are at least once, not exactly once.
Financial administrative grants and receipt labels do not establish Stripe settlement.
Future items above are explicitly unimplemented; no new feature is introduced by Phase 15.
Approved clinical references, dataset licenses/consent/de-identification and medical
wording review remain prerequisites, not presumed from legacy training folders.

## 10. Deployment and acceptance

Use [README local setup](../README.md) for generated local-only secrets/synthetic fixtures.
For an isolated pilot use [Phase 14 operations](phase14-operations.md): immutable image,
private PostgreSQL/object volumes, mounted secrets, restricted DB identity, operator
TLS/SMTP, reviewed migrations and backup-first rollout/rollback. There are no destructive
down migrations or automatic clinical-history deletion. Validate migration hashes and
restore into new empty volumes; preserve post-backup writes before any switch.

Final acceptance is conditional on [verification](phase15-final-verification.md).
Engineering tests do not authorize patient-care recommendations or regulatory claims.
