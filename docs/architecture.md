# Architecture

## Runtime boundaries

- `apps/web` contains the existing React/Vite user interface. It still talks to Supabase directly where
  the existing product does so; feature migration has not started.
- `apps/api` owns HTTP delivery, the `/api/health` endpoint, Vite middleware during development, and
  static frontend delivery in production.
- `services/ai` reserves an independently deployable Python boundary for future validated inference.
  It exposes health only and must not fabricate clinical output.
- `packages/contracts` owns Zod transport schemas shared by TypeScript applications.
- `packages/domain` owns framework-independent rules, beginning with clinical feature gating.
- `packages/database` owns the server-only Drizzle model, reviewed PostgreSQL migrations, and database
  integration tests. It must not be imported by `apps/web`.
- `packages/ui` owns reusable presentation components without application routing or data access.

## Dependency direction

Applications may depend on packages. Packages must not depend on applications. The web application may
not call a future inference implementation directly; validated inference integration must enter through
an explicitly reviewed API contract and preserve the clinical feature gates.

PostgreSQL and MinIO are the self-hosted infrastructure target. The Phase 4 schema is available only to
server-side code; Supabase remains functional and no authentication, frontend, clinical-data, or
storage migration is implied by the schema's presence.

## Development and production serving

`npm run dev` starts the Express application, which mounts Vite in middleware mode against `apps/web`.
`npm run build` builds shared packages, the Vite assets, and the API. `npm start` then serves
`apps/web/dist` from the compiled API process.
