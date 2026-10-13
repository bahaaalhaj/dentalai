# DentalAI

Current specification: [aligned SRS](docs/srs.md), [requirements-to-tests matrix](docs/requirements-traceability.md)
and [Phase 16 verification](docs/phase16-final-verification.md). These supersede earlier
present-tense architecture/completion claims; historical phase reports describe their dated checkpoints.

Phase 16 repairs the merge, bounds private imaging, adds audited recovery and regression gates,
and reduces runtime/container and frontend attack surface. It is not production or clinical approval.
Use npm 11.17.0 for the documented install/CI/container flow; npm 10 produced a nested esbuild
optional-binary mismatch in the Linux build. The supported policy remains Node 22+ (CI: Node 22);
the observed local run uses Node 24.19.0. Root preinstall rejects other npm versions.
See [release readiness](docs/phase14-release-readiness.md), [operations and restore](docs/phase14-operations.md)
and the [scoped OWASP ASVS review/threat model](docs/phase14-threat-model.md).
Current additions: [storage/recovery](docs/phase16-storage-and-recovery.md),
[security design blockers](docs/phase16-security-design.md), [data/model governance](docs/ml-data-governance.md).

Use one `RELEASE_TAG` for `npm run release:build`, `npm run release:build:ai`,
`npm run release:build:postgres`, Compose and
`npm run test:restore-drill`; the local default is `local-verification`, never a published release.
CI uses a commit-derived tag. Runtime uses a pinned non-root distroless Node 22 image; there is
no shell, npm or build toolchain. Use the documented Node operator scripts, not shell access.
All workspace package versions remain private `0.0.0`; release identity is the immutable commit/tag
and image digest until an owner-approved distribution/versioning policy exists.

The [Phase 16 remote follow-up](docs/phase16-remote-followup.md) records the first branch's
actual scan findings, AI/PostgreSQL remediation and Linux restore-harness correction.
Local scanner access remains blocked; the report records successful remote all-image
scans and Linux restore verification. Green engineering CI is not clinical or production
approval; the documented operational and clinical prerequisites still apply.

Additional gates: `npm run source:check`, `npm run i18n:arabic`, `npm run bundle:check`
(after build), and `npm run test:coverage` (with disposable `DATABASE_URL`). Coverage JSON/HTML/LCOV
are under ignored `coverage/`. Public/production governance checks intentionally fail until
reviewed mandatory fields and the repository license are resolved: `npm run governance:check -- public`.

React/Vite frontend, Express API, self-hosted PostgreSQL and private clinical object storage.
The browser uses `/api/v1` contracts, never database credentials. Phase 12 is an **intentional
disposable-test-data reset**, not a legacy migration. See the [reset report](docs/phase12-test-data-reset.md).

X-ray inference and anesthesia are experimental and **must not be used for patient-care decisions**.
The intended boundary is AI-assisted decision support requiring clinician confirmation;
clinician confirmation is not system clinical validation. Anesthesia is rule-based, not a second AI model.
No approved dental model/evaluation or approved anesthesia references are bundled. Anesthesia
recommendations and confirmation remain disabled even when a demo flag is enabled. Missing
inference returns unavailable, never fabricated findings.

## Clean-clone local setup

Requirements: Node.js 22+, compatible npm and Docker Compose. Install/cache dependencies,
PostgreSQL and the test browser before disconnecting. Installed application flows require only
local PostgreSQL and explicitly configured private filesystem storage/mail.

```bash
npm install --global npm@11.17.0 --ignore-scripts
npm ci
npm run dev:configure
npm run infra:up:local
npm run dev:seed
npm run dev
```

Open `http://localhost:3000`. Configuration generation creates ignored `.env` and `infra/.env`
with fresh local-only secrets and refuses to overwrite existing files. Preserve existing configuration
and configure manually from names in `.env.example` when necessary. Local Compose uses loopback
port 55432, a health check and a named volume. `npm run infra:down:local` stops without deleting data.
Private objects/mail are under ignored `.local/`, never publicly mounted. Protect them with OS ACLs,
especially on Windows; never deploy these development fixtures.

With the application running, `npm run smoke:local` checks real generated-user logins, roles,
appointments and permitted clinical/billing/image/anesthesia reads without printing credentials.

`npm run dev:seed` applies reviewed migrations and seeds synthetic fixtures in a dedicated local
development/test database. Repeating it preserves rows/password hashes. An incompatible tenant
or currency fails rather than overwriting data; use a new database and retain the old one.
Default tenant: `10000000-0000-4000-8000-000000000001`; timezone `Etc/UTC`.
Every tenant-owned fixture belongs to it. Sample prices are **SYP**, numeric values preserved
1:1 without conversion. Global identities link through clinic memberships.

Local login emails:

- `owner@example.invalid` — clinic owner
- `admin@example.invalid` — clinic admin
- `dentist@example.invalid`, `dentist2@example.invalid` — dentists
- `receptionist@example.invalid` — receptionist
- `patient@example.invalid` — linked synthetic portal patient

The generated local-only password is in ignored `.local/development-credentials.json`.
Read it locally; never post/commit it. Alternatively supply your local-only
`DENTALAI_DEVELOPMENT_PASSWORD` to seeding. Reseeding does not reset passwords.
Actual development verification/reset emails are captured privately under `.local/mail/`;
production prohibits this mail driver. Public registration never grants staff access or links
clinical patients. Production uses invitations, reviewed owner provisioning, SMTP, HTTPS and fresh secrets.

## Verification and serving

```bash
npm run verify
npm run test:db
npx playwright install --with-deps --no-shell chromium
npm run test:e2e
```

Database/browser tests require `DATABASE_URL` for a local administrator able to create/drop
disposable UUID-named databases. They do not alter the seeded application database.

- `typecheck`, `lint`, `format:check`, `test`, `build`, `audit` have their named meanings.
- `test:db` checks migrations from zero, preserved upgrades, tenancy, authorization, concurrency,
  transactions, ledger reconciliation, private files and repeated seed integrity.
- `test:e2e` checks real booking/confirmation, clinical approval/patient projection,
  invoice/payment/refund and private image upload/versioning; imaging blocks external requests.
- CI also runs inference fixtures, artifact hygiene and redacted secret scanning.

Build/start without Vite: `npm run build`, then `npm start`. Generated local settings keep
`NODE_ENV=development` while serving built assets; real production needs production settings and SMTP.
Independent API: `npm run dev:api`. Independent frontend: `npm run dev:web` (set `APP_ORIGIN`
to its exact origin). Health: `/api/v1/health/live`, `/api/v1/health/ready`;
OpenAPI: `/api/v1/contracts/v1?format=openapi`.

## Product boundaries and limitations

Phase 13 adds [clinic administration](docs/saas-administration.md): guided onboarding,
owner/admin configuration, memberships, server-enforced plans/usage, export and retained
offboarding. New clinics start an administrative trial; **no subscription payments are
processed**. Additional clinics/owner transfer require operator review. Open **Clinic
administration** or **Set up a new clinic** in the account dashboard. Enable
`OUTBOX_WORKER_ENABLED=true` in existing configuration for queued invitations (newly generated
configurations enable it). English/Arabic and RTL are prepared; medical English remains
pending professional review. See [Phase 13 verification](docs/phase13-verification.md).

Authentication uses opaque server-owned sessions, Secure cookies, CSRF and membership-derived roles.
Appointments use transactional booking and database resource exclusion constraints. Clinical records
use immutable revisions, explicit tooth actions and approved-only portal projections. Billing uses
immutable financial events, not current tooth status. Images require authorized backend streaming.
Changes deliberately refresh via API; no cloud realtime fallback remains.

Seed clinical records remain drafts until explicit dentist review. The seed X-ray is metadata only,
with zero binaries/AI results. Use explicitly synthetic uploads for storage testing. The seeded
anesthesia assessment is blocked with no dose recommendation.

Before patient-care deployment: clinical/model/reference approval, retention/licensing review,
least-privilege database access, TLS, encrypted storage/backups, restore testing and operational
security review. No payment processor or clinical validation is claimed. Historical ML assets remain
preserved pending safe artifact migration; secret scanning cannot prove licensing/de-identification.

## Layout and references

```text
apps/web/             React/Vite
apps/api/             Express domains and local fixture tools
services/ai/          Private inference, fail-closed without a model
packages/contracts/   Browser-safe Zod transport schemas
packages/domain/      Pure business rules and clinical safety gates
packages/database/    Server-only Drizzle and reviewed migrations
packages/ui/          Shared presentation
infra/                Docker configuration
docs/                 Architecture, security and validation notes
```

[Architecture](docs/architecture.md), [ADR](docs/adr/0001-modular-monolith-and-ai-service.md),
[authentication](docs/authentication.md), [appointments](docs/appointments.md),
[schema](docs/database-schema.md), [clinical safety](docs/clinical-validation.md),
[private imaging](docs/private-imaging.md), [anesthesia](docs/anesthesia-decision-support.md),
[deployment/backup](docs/deployment-and-backup.md), [ML artifact migration](docs/ml-artifact-migration.md).

## Author

**Bahaa Alhaj** - AI Engineering student
[GitHub profile](https://github.com/bahaaalhaj)
