# API foundation

The versioned server boundary at `/api/v1` owns authentication, tenancy and all implemented domains.
The browser uses safe transport schemas, never database models or credentials. The retained
foundation below is extended by domain-specific clinical, billing and file contracts.

Authentication requires `AUTH_SECRET`, `APP_ORIGIN` and explicitly configured mail. Production uses
`SMTP_URL` / `MAIL_FROM`; offline development can use private filesystem mail.
See [authentication](authentication.md) and [local setup](../README.md).

## Running the API

Set the server-only `DATABASE_URL`, then run the API without Vite:

```bash
npm run build:packages
npm run dev:api
```

The API defaults to `http://localhost:3000`. `npm run dev` retains the integrated Express/Vite
development experience, while `npm start` serves the production web bundle. The independent API mode
does not load Vite or require built frontend assets.

## Versioned endpoints

| Method | Path                                  | Purpose                                                                 |
| ------ | ------------------------------------- | ----------------------------------------------------------------------- |
| `GET`  | `/api/v1/health/live`                 | Process liveness; it deliberately does not query dependencies           |
| `GET`  | `/api/v1/health/ready`                | Database/lifecycle and configured web, storage, worker and AI readiness |
| `GET`  | `/api/v1/contracts/v1?format=openapi` | OpenAPI 3.1 document generated from shared Zod contracts                |

`GET /api/health` remains as a compatibility alias. No clinical operation returns a placeholder success
response; implemented clinical routes use their actual shared contracts.

## Request lifecycle

1. A safe incoming `x-request-id` is retained; otherwise the API creates a UUID and echoes it.
2. Pino filters final serialized output to allowlisted operational metadata; URL/query/body,
   patient/clinic identifiers and arbitrary exception objects are omitted. Native request spans
   use server-generated trace/span IDs; they are not a deployed OTLP tracing system.
3. Helmet applies security headers. CORS denies cross-origin use unless an exact origin is configured;
   wildcard origins are rejected at startup.
4. In-memory API rate limits run before body parsing and emit standardized headers and a safe error.
   A distributed limiter is intentionally absent because Redis is out of scope.
5. JSON and URL-encoded parsers enforce the configured body limit; imaging has its own bounded parser.
6. Zod validates configured path parameters, query strings, bodies, and outgoing responses.
7. Central error handling maps known domain failures to safe codes and hides stack traces, SQL details,
   hosts, and credentials.

## Code boundaries

```text
apps/api/src/
  config/             server-only environment parsing
  domains/system/     health repository, service, and HTTP routes
  domains/audit/      transactional audit-event writer
  errors/             domain error vocabulary
  infrastructure/     logging and lifecycle state
  middleware/         request IDs, validation, limits, and error responses
  workers/            PostgreSQL transactional notification-outbox worker
packages/contracts/   browser-safe Zod schemas and OpenAPI generation
packages/database/    server-only Drizzle schema and transaction helper
apps/web/src/lib/     typed API client for implemented domains
```

Domain modules own their repository/service/route composition. Generic controller and repository
folders are intentionally avoided.

## Transactions, audit, and outbox

`withTransaction` supplies a typed Drizzle transaction. `AuditEventWriter` accepts that same transaction
so a domain change and its audit record commit or roll back together. The audit table is append-only at
the database layer.

The outbox worker claims one PostgreSQL row at a time with `FOR UPDATE SKIP LOCKED`, dispatches through a
topic-handler map, and marks completion or a retryable failure. The current server registers the real
`notification.email` handler. Enablement requires `OUTBOX_WORKER_ENABLED=true`; generated development
configuration enables it and staging/production requires it. No fake clinical jobs exist.

Review repairs add a five-minute default claim lease and reclaim expired processing rows. Attempt
numbers fence stale acknowledgments; worker identities are globally unique. Delivery is **at least
once**, not exactly once: handlers must tolerate duplicates and finish within their lease. There is no
lease-extension heartbeat or external dead-letter broker; eight exhausted attempts need operator review.
Worker readiness uses its successful-poll heartbeat. Errors are recorded as safe fixed codes;
raw handler/driver messages and payloads are not logged. Shutdown closes Vite resources, drains HTTP
requests before ending the database pool, and enforces its deadline even when a handler hangs.

## Configuration

All server settings are validated before listening. Private `NAME_FILE` secret mounts and separate
deployment environments are supported; see [operations](phase14-operations.md).
`DATABASE_URL` is required and must use a PostgreSQL
protocol. `CORS_ORIGINS` is a comma-separated exact allowlist. See `.env.example` for names; it contains
no secrets. None of these values uses a `VITE_` prefix, so they are not exposed to the browser bundle.

## Verification

```bash
npm test
npm run test:db
```

Unit tests cover environment and domain validation, malformed requests, body limits, dependency failure,
response validation, safe errors, and generated documentation. Database integration tests create a
temporary database from zero and prove connectivity, rollback, committed audit writing, and safe
readiness failure. CI supplies PostgreSQL; local integration runs require a disposable PostgreSQL admin
URL with permission to create and drop test databases.
