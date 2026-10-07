# DentalAI

DentalAI is an npm-workspace modular monorepo. The current product remains a React/Vite application
served by an Express API, with Supabase retained temporarily while later feature migrations are out of
scope. The X-ray analysis and anesthetic decision-support modules remain experimental and disabled by
default.

## Repository layout

```text
apps/web/             React and Vite frontend
apps/api/             Express API and web host
services/ai/          FastAPI health-only inference-service boundary
packages/contracts/   Shared Zod transport schemas
packages/domain/      Framework-independent business rules
packages/database/    Drizzle schema, reviewed SQL migrations, seed, and database tests
packages/ui/          Shared React UI components
infra/                Local Docker infrastructure and retained Supabase schema
docs/                 Architecture, security, safety, and migration notes
```

See [docs/architecture.md](docs/architecture.md) and
[docs/adr/0001-modular-monolith-and-ai-service.md](docs/adr/0001-modular-monolith-and-ai-service.md).

## Requirements

- Node.js 22 or newer
- npm 11 or a compatible npm version supplied with Node.js 22+
- Docker with Compose for local PostgreSQL and object storage
- A Supabase project for current interactive application behavior
- Python 3.12+ only when running the optional AI-service placeholder directly

## Application setup

```bash
git clone <repository-url>
cd dentalai
npm ci
cp .env.example .env
```

Set the public browser values in `.env`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

Never place a Supabase service-role key in this repository. Missing or malformed settings produce a
clear `SupabaseConfigurationError`.

Start the integrated Express and Vite development server:

```bash
npm run dev
```

The application is available at `http://localhost:3000`; API health is at `/api/health`. For a
frontend-only Vite server, use `npm run dev:web`. To run a production build locally:

```bash
npm run build
npm start
```

## Local infrastructure

```bash
cp infra/.env.example infra/.env
# Fill every credential and bucket field with unique local-only values.
npm run infra:config
npm run infra:up
```

This starts PostgreSQL and private S3-compatible MinIO storage with health checks and named volumes.
No default database or object-storage credentials are committed. Use `npm run infra:down` to stop the
stack. `npm run infra:up:ai` additionally starts the health-only Python service.

To create the self-hosted schema, set the server-only `DATABASE_URL` (never a `VITE_` variable), then
run:

```bash
npm run db:migrate --workspace @dentalai/database
npm run db:seed --workspace @dentalai/database # optional fictional development data
npm run test:db                                 # uses a generated disposable database
```

See [docs/database-schema.md](docs/database-schema.md) for the schema and unresolved decisions, and
[docs/migration/supabase-to-postgresql.md](docs/migration/supabase-to-postgresql.md) for the non-executed
legacy mapping. The web application still uses Supabase in this phase and never connects directly to
PostgreSQL.

## Verification

The clean-clone flow is:

```bash
npm ci
npm run verify
```

- `npm run typecheck` — strict TypeScript validation across workspaces
- `npm run lint` — repository ESLint with zero warnings allowed
- `npm run format:check` — Prettier conformance
- `npm test` — isolated web unit tests with mocked Supabase and blocked network access
- `npm run test:db` — rebuild migrations from zero and verify PostgreSQL constraints (requires `DATABASE_URL`)
- `npm run build` — shared packages, frontend, and API production builds
- `npm run audit` — dependency audit at high severity or above

## Experimental limitations

- X-ray analysis has no inference runtime and produces no findings.
- Anesthetic decision support is unvalidated and remains gated behind development/demo flags.
- The FastAPI service exposes health only and has no inference endpoint.
- None of these modules may be used for patient-care decisions. See
  [docs/clinical-validation.md](docs/clinical-validation.md).
- Supabase remains the current application backend. The self-hosted PostgreSQL schema now exists as a
  reviewed migration target, but no frontend, authentication, or clinical-data migration has begun.

## Clinical feature flags

Both an allowed environment and the relevant flag are required:

```dotenv
VITE_CLINICAL_ENV=demo
VITE_ENABLE_XRAY_ANALYSIS=true
VITE_ENABLE_ANESTHETIC_DECISION_SUPPORT=true
```

Do not enable them in production or for patient care.

## ML repository hygiene

Historical datasets, training outputs, and model weights remain tracked so valuable content is not
lost. New artifacts are ignored. Follow
[docs/ml-artifact-migration.md](docs/ml-artifact-migration.md) before removing historical content.
