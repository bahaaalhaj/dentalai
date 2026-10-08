# DentalAI

DentalAI is an npm-workspace modular monorepo. The current product remains a React/Vite application
served by an Express API, with Supabase retained temporarily while later feature migrations are out of
scope. The X-ray analysis and anesthetic decision-support modules remain experimental and disabled by
default.

Authentication and appointments now use the backend API and self-hosted PostgreSQL. Open
**Appointments and calendar** from the account dashboard. See [docs/appointments.md](docs/appointments.md)
for scheduling setup, permissions, timezone policy, and operator prerequisites.

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
- SMTP delivery/capture and PostgreSQL for backend-owned authentication; Supabase is retained only for unmigrated features
- Python 3.12+ only when running the optional AI-service placeholder directly

## Application setup

```bash
git clone <repository-url>
cd dentalai
npm ci
cp .env.example .env
```

Set server-only `DATABASE_URL`, `AUTH_SECRET` (random, 32+ characters), `APP_ORIGIN`, `SMTP_URL`,
and `MAIL_FROM` in `.env`. Start local infrastructure and apply migrations below before starting the
API. See [docs/authentication.md](docs/authentication.md) for verification, invitations, initial owner
provisioning, and HTTPS/cookie requirements. Auth screens no longer require Supabase credentials.

For retained legacy feature modules, public browser values remain:

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

The application is available at `http://localhost:3000` when APP_ORIGIN uses that origin; API health is at `/api/health`. Secure cookies remain enabled locally. For a
frontend-only Vite server, use `npm run dev:web`. To run the versioned API independently from Vite, set
`DATABASE_URL` and use `npm run dev:api`; liveness is at `/api/v1/health/live`, readiness is at
`/api/v1/health/ready`, and generated OpenAPI is at `/api/v1/contracts/v1?format=openapi`. See
[docs/api-foundation.md](docs/api-foundation.md). To run a production build locally:

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
legacy mapping. Authentication, appointments and Phase 8 clinical records now use the backend API.
Unmigrated billing, files and experimental-tool code retain Supabase but are not routed with the new
sessions. The browser never connects directly to PostgreSQL.

## Verification

The clean-clone flow is:

```bash
npm ci
npm run verify
```

- `npm run typecheck` — strict TypeScript validation across workspaces
- `npm run lint` — repository ESLint with zero warnings allowed
- `npm run format:check` — Prettier conformance
- `npm test` — isolated web and API unit tests; Supabase and external network access stay mocked
- `npm run test:db` — rebuild migrations from zero, verify PostgreSQL constraints, and run API database integration tests (requires `DATABASE_URL`)
- `npm run build` — shared packages, frontend, and API production builds
- `npm run test:e2e` — real production-browser appointment and clinician-approval/patient-history flows,
  using disposable PostgreSQL; run the build and `npx playwright install --with-deps --no-shell chromium` first
- `npm run audit` — dependency audit at high severity or above

## Experimental limitations

- X-ray analysis has no inference runtime and produces no findings.
- Anesthetic decision support is unvalidated and remains gated behind development/demo flags.
- The FastAPI service exposes health only and has no inference endpoint.
- None of these modules may be used for patient-care decisions. See
  [docs/clinical-validation.md](docs/clinical-validation.md).
- Backend-owned authentication, invitations, clinic membership, RBAC, appointments and availability are
  implemented. Phase 8 adds dentist-authored encounters, immutable clinical revisions, explicit review,
  normalized findings/procedures and treatment items, and an approved-only read-only patient portal.
  Scheduling
  requires configured locations/timezones, an invited dentist, chairs, types/hours, and explicitly
  linked patient entities; legacy appointment data is not automatically imported.
- Select **Clinical patients** as an active dentist with an active provider record; select a patient,
  start an encounter, save explicit draft entries, then approve or reject them with a reason. Close
  the encounter only after review. Corrections append versions in an open encounter. Patients use
  **Approved clinical history**, independently of appointments. Owners/admins are not clinicians
  unless separately assigned the dentist role/provider record.
- Phase 8 uses FDI two-digit tooth notation. No unrecorded tooth is assumed healthy and clicking a
  tooth never changes its condition. See the [clinical workflow and numbering rules](docs/clinical-validation.md#phase-8-clinical-record-workflows).
- Hosted Supabase records are not automatically imported or deleted. Older self-hosted normalized
  rows remain visible to clinicians in a clearly labeled read-only reconciliation archive, never
  auto-approved for patients. Source identifiers, tooth notation, authorship and portal linkage must
  be reconciled before a live data cutover; legacy tooth-derived billing totals are unavailable.
- Existing Supabase users/sessions are not automatically imported. SMTP, HTTPS, owner provisioning,
  patient linkage, retention, MFA, and production security review require operator decisions; see the
  [authentication scope and limitations](docs/authentication.md).

## Clinical feature flags

Both an allowed environment and the relevant flag are required:

```dotenv
VITE_CLINICAL_ENV=demo
VITE_ENABLE_XRAY_ANALYSIS=true
VITE_ENABLE_ANESTHETIC_DECISION_SUPPORT=true
```

Do not enable them in production or for patient care.

## ML repository hygiene

See [the independent phase review](docs/phase7-verification.md#independent-review) for acceptance gaps, corrective migrations,
actual verification results and outstanding deployment decisions. Passing local checks does not mean
the existing Supabase deployment, clinical modules or training datasets are validated or safe for
patient data.

Historical datasets, training outputs, and model weights remain tracked so valuable content is not
lost. New artifacts are ignored. Follow
[docs/ml-artifact-migration.md](docs/ml-artifact-migration.md) before removing historical content.
