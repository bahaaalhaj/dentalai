# Security notes

- Repository examples contain variable names only. Supabase service-role credentials must never be
  exposed to the browser or committed.
- Docker Compose requires explicit PostgreSQL and MinIO credentials; it supplies no credential defaults.
- The MinIO bootstrap container creates the configured bucket with anonymous access disabled.
- Compose port publishing is loopback-only, including PostgreSQL and the MinIO administration console.
- Local named volumes may contain sensitive development data and must not be copied into the repository.
- The FastAPI placeholder exposes no inference or upload route.
- Unit tests replace Supabase and block network access.

These controls support local development; they are not a production security accreditation.

## Phase 8 clinical access

Only active dentists with active provider records may author/read/review clinical workspaces. Admin,
owner and receptionist roles alone are insufficient. Each transaction revalidates live authorization;
patient and encounter locks serialize corrections, approvals and closure. Patients receive only their
linked approved projection, never draft/rejected/internal-review/archive data. Clinical routes use the
existing CSRF, body limits, request IDs, no-store responses, safe errors and rate limits. Clinical content
must not enter access/error logs; audit before/after data is sensitive and needs restricted DB/backup
access and a legally reviewed retention policy. Approval means a recorded clinician decision, **not**
software or clinical validation. The workflow permits self-approval, not mandatory two-person review.

## Legacy deployment is not automatically secured

Removing Supabase calls from the routed frontend does not revoke access to an existing hosted
database or storage bucket. The archived schema historically granted full appointment-row public
read access, patient deletion, and public X-ray object reads. Its appointment provisioning statements
now fail closed, but no remote database was inspected or changed during the review. Before cutover,
back up/reconcile legacy appointments and apply the reviewed appointment freeze script; verify the
actual hosted policies and grants. Separately inventory and restrict legacy clinical/storage access
with its owners before any patient-data deployment. Do not assume unmounting a screen protects data
already reachable through a Supabase URL/key.

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

Retiring browser Supabase billing calls does not revoke hosted table access. Before live cutover,
operators must back up and reconcile old prices/payments, review actual hosted RLS/grants,
restrict old writes, and confirm receipt/settlement reconciliation. Existing datasets/models and
storage dependencies remain unchanged; Phase 9 is not a patient-data deployment certification.
Historical datasets/weights remain tracked pending the approved artifact migration; their consent,
licensing, PHI classification and retention are unresolved. No dataset/model content was removed.
