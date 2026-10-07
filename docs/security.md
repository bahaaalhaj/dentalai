# Security notes

- Repository examples contain variable names only. Supabase service-role credentials must never be
  exposed to the browser or committed.
- Docker Compose requires explicit PostgreSQL and MinIO credentials; it supplies no credential defaults.
- The MinIO bootstrap container creates the configured bucket with anonymous access disabled.
- Local named volumes may contain sensitive development data and must not be copied into the repository.
- The FastAPI placeholder exposes no inference or upload route.
- Unit tests replace Supabase and block network access.

These controls support local development; they are not a production security accreditation.
