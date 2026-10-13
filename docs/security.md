# Security notes

Current security evidence/gaps: [Phase 15](phase15-final-verification.md) and
[scoped ASVS/threat model](phase14-threat-model.md). This is not regulatory approval.
The pilot requires mounted secrets, separate non-owner runtime DB identity, trusted HTTPS edge,
private monitoring and configured worker/SMTP; operational provisioning still needs verification.

Phase 13 rechecks membership/session/clinic permissions within administrative transactions.
Owner-only export/offboarding needs recent sign-in; exports exclude credentials/public
objects. Notification tokens are encrypted at rest and quotas database-enforced.
Administrative grants never represent payment evidence. See [administration](saas-administration.md).

- Repository examples contain variable names only. Database, auth and storage credentials must never
  be exposed to the browser or committed. Generated local credentials/configuration are ignored.
- Docker Compose requires explicit PostgreSQL and MinIO credentials; it supplies no credential defaults.
- The MinIO bootstrap container creates the configured bucket with anonymous access disabled.
- Compose port publishing is loopback-only, including PostgreSQL and the MinIO administration console.
- Local named volumes may contain sensitive development data and must not be copied into the repository.
- The private FastAPI service uses actual versioned inference or a safe unavailable error, never simulation.
- Unit tests block network access. Integration tests use disposable local PostgreSQL.
- Explicit filesystem storage is private, immutable and never mounted as web assets. Vite denies private
  object/mail/credential directories. Apply Windows ACLs; mode bits alone are not an access policy.
- Filesystem mail captures actual messages privately only in development/test; production rejects it.
- Helmet retains same-origin script/connection defaults. `script-src` additionally permits
  `wasm-unsafe-eval` for the bundled landing animation only; JavaScript `unsafe-eval`, external
  scripts and external connections remain disallowed. Browser tests assert actual rendering offline.

These controls support local/pilot preparation; they are not production security accreditation.
Per-tenant PostgreSQL RLS, MFA/common-password blocking, independent penetration testing,
immutable off-host audit custody and deployment TLS/disk encryption are not completed claims.

## Phase 8 clinical access

Only active dentists with active provider records may author/read/review clinical workspaces. Admin,
owner and receptionist roles alone are insufficient. Each transaction revalidates live authorization;
patient and encounter locks serialize corrections, approvals and closure. Patients receive only their
linked approved projection, never draft/rejected/internal-review/archive data. Clinical routes use the
existing CSRF, body limits, request IDs, no-store responses, safe errors and rate limits. Clinical content
must not enter access/error logs; audit before/after data is sensitive and needs restricted DB/backup
access and a legally reviewed retention policy. Approval means a recorded clinician decision, **not**
software or clinical validation. The workflow permits self-approval, not mandatory two-person review.

## Former hosted project is not automatically secured

The Phase 12 reset is authorized for disposable test data only; no source backup/counts were obtainable
and no hosted policies were changed. SDK/configuration removal does not revoke old hosted access.
Project shutdown, public-policy retirement and credential revocation remain operator actions.
No legacy public bucket/policy setup remains in local deployment. See
[the reset report](phase12-test-data-reset.md); do not mistake local independence for remote retirement.

Repository secret scanning does not establish that training images are de-identified or licensed.

## Phase 9 financial authorization

Billing routes live under `/api/v1/billing` and reuse opaque backend sessions, CSRF protection,
strict Zod input/response contracts, request IDs, limits and safe centralized errors. Every
operation rechecks live session, active clinic, membership and roles inside its transaction;
browser-supplied clinic/user/author/status fields are rejected. Owner/admin manage pricing,
refunds and adjustments; owner/admin/receptionist issue invoices and record payments; dentists
read only. Patients cannot mutate finances or select another patient ID in the portal query.
Portal access derives `patients.portal_user_id` from the authenticated user and active clinic,
excludes drafts/discarded invoices, and omits internal mutation reasons. Source clinical IDs
are verified against clinic/patient and clinician approval before linking an invoice line.

Financial audits retain actor, clinic, patient, timestamp, reason and before/after evidence.
Audit failure rolls back the money mutation. Idempotent payment/refund retries do not duplicate
money or receipts. Stored payment methods are labels only: do not enter card PAN/CVV, bank
credentials or other secrets into external receipt references or change reasons. No payment
processor is integrated, and recording a refund does not itself transfer funds.

The approved test-data reset imports no historical money. For any real financial deployment, operators
must separately reconcile provenance/currency/settlements and test backup/restore. This is not a
patient-data deployment certification.
Historical datasets/weights remain tracked pending the approved artifact migration; their consent,
licensing, PHI classification and retention are unresolved. No dataset/model content was removed.
