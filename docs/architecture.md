# Architecture

Phase 7 update: browser authentication and membership lookup use `/api/v1/auth` and `/api/v1/access`;
appointments and anonymized availability use `/api/v1/appointments` and `/api/v1/scheduling` with
self-hosted PostgreSQL. Legacy Supabase clinical/billing code remains installed but clinical dashboards
are not routed with new sessions. See [authentication.md](authentication.md) and
[appointments.md](appointments.md) for the access and scheduling boundaries.

## Runtime boundaries

- `apps/web` contains the React/Vite user interface. Routed authentication and scheduling use only
  backend transport contracts. Retained, unrouted clinical/billing code still uses Supabase.
- `apps/api` owns HTTP delivery, the `/api/health` endpoint, Vite middleware during development, and
  static frontend delivery in production. Its versioned `/api/v1` boundary is organized into domain
  repositories, services, and routes; it can also run independently without Vite.
- `services/ai` reserves an independently deployable Python boundary for future validated inference.
  It exposes health only and must not fabricate clinical output.
- `packages/contracts` owns Zod transport schemas shared by TypeScript applications.
- `packages/domain` owns framework-independent clinical feature gates, appointment transitions, and
  Temporal-based timezone/date utilities.
- `packages/database` owns the server-only Drizzle model, reviewed PostgreSQL migrations, and database
  integration tests. It must not be imported by `apps/web`.
- `packages/ui` owns reusable presentation components without application routing or data access.

## Dependency direction

Applications may depend on packages. Packages must not depend on applications. The web application may
not call a future inference implementation directly; validated inference integration must enter through
an explicitly reviewed API contract and preserve the clinical feature gates.

`packages/contracts` is browser-safe and may contain Zod transport schemas, inferred DTO types, and API
documentation metadata. It must not expose database models, server environment values, or credentials.
`packages/database` is server-only and must not be imported into `apps/web`.

PostgreSQL and MinIO are the self-hosted infrastructure target. The Phase 4 schema is available only to
server-side code; Supabase remains for unmigrated clinical/billing features. Authentication and scheduling
are migrated as runtime features; legacy-data imports and clinical/storage migrations have not occurred.

Browser E2E files under `apps/web/e2e` run in Node and import a server-side fictional database fixture;
these are not browser application modules and are never bundled into the frontend.

## Development and production serving

`npm run dev` starts the Express application, which mounts Vite in middleware mode against `apps/web`.
`npm run build` builds shared packages, the Vite assets, and the API. `npm start` then serves
`apps/web/dist` from the compiled API process.
