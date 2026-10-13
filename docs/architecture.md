# Architecture

Current requirements and verification: [aligned SRS](srs.md),
[traceability](requirements-traceability.md), [final report](phase15-final-verification.md).

Phase 13 adds tenant administration, subscription capacity triggers and a PostgreSQL
notification outbox inside the modular monolith, not payment processing/new services.
See [administration](saas-administration.md).

Phase 12: all routed workflows use the local `/api/v1` boundary and self-hosted PostgreSQL.
The approved disposable-test-data reset is not a legacy import. See
[the reset report](phase12-test-data-reset.md), [authentication](authentication.md) and
[appointments](appointments.md).

## Runtime boundaries

- `apps/web` contains the React/Vite interface and browser-safe API contracts only. Authentication,
  scheduling, clinical records, billing, files and anesthesia have no direct database client.
- `apps/api` owns HTTP delivery, the `/api/health` endpoint, Vite middleware during development, and
  static frontend delivery in production. Its versioned `/api/v1` boundary is organized into domain
  repositories, services, and routes; it can also run independently without Vite.
- `services/ai` contains private, versioned inference. Missing/unhealthy configured model artifacts
  return unavailable. No fabricated findings or approved clinical performance are bundled.
- `packages/contracts` owns Zod transport schemas shared by TypeScript applications.
- `packages/domain` owns framework-independent clinical feature gates, appointment transitions, and
  Temporal-based timezone/date utilities.
- `packages/database` owns the server-only Drizzle model, reviewed PostgreSQL migrations, and database
  integration tests. It must not be imported by `apps/web`.
- `packages/ui` owns reusable presentation components without application routing or data access.

## Dependency direction

Applications may depend on packages. Packages must not depend on applications. The web application may
not call the inference implementation directly; inference integration must enter through
an explicitly reviewed API contract and preserve the clinical feature gates.

`packages/contracts` is browser-safe and may contain Zod transport schemas, inferred DTO types, and API
documentation metadata. It must not expose database models, server environment values, or credentials.
`packages/database` is server-only and must not be imported into `apps/web`.

PostgreSQL is server-only. Private storage explicitly selects S3/MinIO or filesystem; neither is
publicly mounted and S3 failure never triggers a filesystem fallback. Offline development uses a
private filesystem mailbox (prohibited in production); production requires SMTP. Deliberate API
refresh replaces cloud realtime behavior. See [deployment and backup](deployment-and-backup.md).

Browser E2E files under `apps/web/e2e` run in Node and import a server-side fictional database fixture;
these are not browser application modules and are never bundled into the frontend.

## Development and production serving

`npm run dev` starts the Express application, which mounts Vite in middleware mode against `apps/web`.
`npm run build` builds shared packages, the Vite assets, and the API. `npm start` then serves
`apps/web/dist` from the compiled API process.
