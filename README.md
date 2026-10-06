# DentalAI

DentalAI is a React/Vite clinic application backed by Supabase. The X-ray analysis and anesthetic decision-support modules are experimental and disabled by default.

## Requirements

- Node.js 22 or newer
- npm 11 or a compatible npm version supplied with Node.js 22+
- A Supabase project for interactive application use

## Local setup

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

Never put a Supabase service-role key in this application repository. Start development with:

```bash
npm run dev
```

Missing or malformed Supabase settings produce a `SupabaseConfigurationError` explaining which variables are required.

## Verification

The clean-clone verification flow is:

```bash
npm ci
npm run verify
```

The individual quality commands are:

- `npm run typecheck` — strict TypeScript validation
- `npm run lint` — ESLint with zero warnings allowed
- `npm run format:check` — Prettier conformance
- `npm test` — isolated unit tests with a mocked Supabase client and blocked network access
- `npm run build` — Vite production build
- `npm run audit` — dependency vulnerability audit at high severity or above

## Experimental limitations

- X-ray analysis has no real inference runtime. The previous randomized simulation was removed and the module produces no findings.
- Anesthetic decision support is unvalidated and unavailable unless a development/demo environment and its individual feature flag are explicitly enabled.
- Neither experimental module may be used for patient-care decisions. See [CLINICAL_SAFETY.md](CLINICAL_SAFETY.md).
- The database schema is not migrated automatically by application startup.

## Clinical feature flags

Both an allowed environment and the relevant flag are required:

```dotenv
VITE_CLINICAL_ENV=demo
VITE_ENABLE_XRAY_ANALYSIS=true
VITE_ENABLE_ANESTHETIC_DECISION_SUPPORT=true
```

Do not enable these in patient-care or production environments.

## Repository hygiene

Historical datasets, converted datasets, training outputs, and model weights are still tracked so no valuable content is lost during stabilization. New ML artifacts are ignored. Follow [ML_ARTIFACT_MIGRATION.md](ML_ARTIFACT_MIGRATION.md) before removing historical artifacts.
