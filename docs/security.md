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
Historical datasets/weights remain tracked pending the approved artifact migration; their consent,
licensing, PHI classification and retention are unresolved. No dataset/model content was removed.
