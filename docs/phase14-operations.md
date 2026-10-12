# Pilot deployment, observability and recovery

This prepares a **single-host, single-API-replica** pilot; it does not authorize production use
of experimental clinical modules. Keep both clinical flags disabled. No real-patient deployment
until the release report's blocked/failed gates are resolved.

## Configuration and containers

Development: existing generated `.env`, private local mail, synthetic seed, `npm run dev`.
Test: explicitly disposable PostgreSQL and fixtures; no real SMTP or patient images.
Staging/production: `NODE_ENV=production`, `DEPLOYMENT_ENV=staging|production`, HTTPS origin,
generated 32+ character auth/monitoring secrets, implicit-TLS SMTP without insecure URL overrides,
worker enabled, restricted application DB login with a generated 20+ character password.
`readEnvironment` fails closed on inconsistent/insecure configuration. Do not copy dev credentials.

`infra/pilot.env.example` contains names only. Set non-secret configuration in a private operator
environment file and use an **absolute** `SECRETS_DIRECTORY`, owned by the operator (0700/ACL).
Populate the six one-line mounts: `postgres_password`, `database_url`, `migration_database_url`,
`auth_secret`, `smtp_url`, `monitoring_token`. Never supply both `NAME` and `NAME_FILE`.
Generate passwords/keys using a CSPRNG; do not paste secrets into tickets, command arguments or Git.

The PostgreSQL bootstrap identity `dentalai_migrator` is privileged and is **never** the API login.
Create `dentalai_app` as NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS, without role memberships,
using a private operator channel. After migrations, apply `infra/runtime-grants.sql` as the migrator.
Runtime refuses a superuser, schema-creating/table-owning identity or mutable audit access.
Only the migration container receives the migration URL mount.

```bash
npm ci
npm run verify
npm run release:build
# Local candidate uses RELEASE_TAG=phase14. For a release, build/tag by the reviewed commit
# and record its resolved digest; never overwrite a published release tag.
docker compose -f infra/compose.pilot.yml config --quiet
docker compose -f infra/compose.pilot.yml up -d postgres
# Verify backup/restore evidence first; for a genuinely new empty database record that fact.
MIGRATION_BACKUP_VERIFIED=true docker compose -f infra/compose.pilot.yml --profile maintenance run --rm migrate
# Create restricted login/apply runtime grants privately, then:
docker compose -f infra/compose.pilot.yml up -d api
SMOKE_ORIGIN=https://staging.example.invalid npm run smoke:staging
```

Use an immutable release tag (and record the resolved image digest), not `latest`.
The app image builds assets offline at runtime, excludes secrets/training content and runs as UID
10001 with read-only rootfs, dropped capabilities, no-new-privileges, bounded CPU/RAM/PIDs and tmpfs.
PostgreSQL has no host port. Objects live in a dedicated named volume, never a static web directory.
They are accessible only through authenticated tenant-authorized API routes.
New object keys explicitly contain the server-authorized clinic UUID; old opaque keys stay readable.

Bind application HTTP to loopback only. Install the reviewed `infra/nginx-pilot.conf` **inside** a
real HTTPS server block on the VPS; provision/renew certificates, restrict SSH and firewall access,
encrypt the host disk/volumes and test proxy/TLS behavior. It is an include, not a complete TLS config.
Never expose PostgreSQL, monitoring, Docker socket or inference ports publicly.

Optional AI overlay: combine `compose.pilot.yml` and `compose.ai.yml` with `--profile ai`, an
existing reviewed model directory and mounted `ai_service_token`. The overlay does **not** enable
API inference. No model means liveness 200 but readiness 503; never treat this as a validated model.
Keep inference unavailable until versioned artifacts/evaluation/clinical review are approved.
The separate development MinIO stack remains available; pilot backup automation below supports
the explicit **private filesystem adapter only**, not S3. Do not claim S3 recovery is covered.

## Health, metrics, traces and errors

`/api/v1/health/live` checks API process responsiveness; `/health/ready` (under `/api/v1`) checks DB,
draining state and configured web asset, private-storage, worker heartbeat and AI readiness probes.
Disabled optional dependencies are reported as `disabled`, not falsely healthy. Worker runs in the
API process and its poll heartbeat is checked independently; it is not a separate pretend service.
PostgreSQL Compose has `pg_isready`; private storage verifies canonical root/access or private S3 ACLs.
AI has `/health` and `/ready`. Web asset presence is probed by API readiness; staging smoke fetches it.

Set `MONITORING_TOKEN_FILE` to activate a separate authenticated listener (9090). Default bind is
loopback; pilot binds to private container networks with **no host port**. `/metrics` returns bounded
HTTP request/error counters and cumulative latency buckets (50/100/250/1000/5000/+Inf ms), RSS/uptime
and outbox pending/exhausted counts. `/ready` returns dependency state. Requests without the bearer
token get 401. Never proxy it publicly. Counters reset after restart.

Native structured HTTP spans have server-generated trace/span IDs, operation group, duration and
status; `x-trace-id` correlates an error report with logs. This is **not** an OTLP distributed-tracing
implementation or an installed external monitoring backend. No URLs, queries, headers, bodies,
patient/clinic IDs, credentials or exception stacks enter these logs.
The AI container disables raw URL/query access logging. Raw authentication-adapter
diagnostics are disabled; safe HTTP error counters and security audit
events remain active. SMTP debug logging is disabled and certificate validation is mandatory.
This follows the [OpenTelemetry sensitive-data guidance](https://opentelemetry.io/docs/security/handling-sensitive-data/):
sensitivity must be defined explicitly; an instrumentation library does not know clinical privacy.

Operator must configure restricted log collection/alert delivery: alert on sustained readiness 503,
5xx rate >1% for 5 minutes, p95 above the clinic's approved target, exhausted outbox >0, backups
older than 26 hours, disk <20%, certificate expiry <14 days. Establish baseline before imposing a capacity SLA.
Retain operational logs 30 days pending local policy approval; audit/clinical retention is separate.
No third-party error SDK receives patient data automatically. Collector/provider integration and
an actual alert-delivery drill remain blocked until selected and provisioned.

## Automated encrypted backup and retention

Backups deliberately pause the API and in-process worker to capture DB and private objects together.
Stop any other writers/operator jobs before the window. The tool restarts a previously running API
even if backup fails; errors must alert an operator. Downtime is explicit, not a zero-downtime claim.
Store a CSPRNG-generated 32-byte hex key in a separate protected file, with an escrow copy off-host.
Do not put the key in the backup directory. Loss of the key makes backups unrecoverable.

```bash
npm run backup -- create --project dentalai-pilot --output /var/backups/dentalai --key-file /etc/dentalai/backup-key
```

Each unique bundle contains authenticated AES-256-GCM encrypted DB dump, private object tar and
encrypted manifest. Fresh IVs, SHA-256 encrypted-artifact hashes, row counts, full object-tree digest
and available-file size/checksum reconciliation are recorded. Plaintext is not written on backup.
Install `infra/backup/dentalai-backup.service`/`.timer` with protected deployment environment and
operator-controlled Docker access. Enable the timer, inspect its exit status, then copy encrypted
bundles off-host via a reviewed provider. Scheduling files do not prove an installed working timer.

Proposed recovery objective: RPO ≤24h and RTO ≤4h, **unqualified** until measured on the VPS.
Retention proposal: 30 daily and 12 monthly verified bundles, at least three recoverable generations,
including a pre-migration generation. Legal/clinic approval and immutable off-host copy are required.
Pruning is manual by the operator after verifying key custody, off-host checksums and a restore;
the tool intentionally has no unverified recursive retention deletion.
Clinical/financial histories are never pruned with backup retention.

## Restore into a clean environment

Create a separate Compose project with new empty PostgreSQL/object volumes and private configuration;
do **not** start its API publicly. Set its restricted app credentials and release tag; use the same
reviewed SQL release. Ensure source credentials do not appear in command arguments/logs.

```bash
docker compose -p dentalai-restore-drill -f infra/compose.pilot.yml up -d postgres
npm run backup -- restore --project dentalai-restore-drill --bundle /var/backups/dentalai/EXACT_BUNDLE --key-file /etc/dentalai/backup-key --ack-empty
```

Restore refuses nonempty DB/object destinations or a running API. It authenticates all encrypted
files **before** pg_restore, rejects unsafe tar paths/links, uses one transaction for the DB,
compares row counts and object-tree/file checksums, revokes restored sessions/verification tokens
and holds noncompleted outbox jobs at exhausted/review-required state. The destination must already
have the restricted `dentalai_app` login; reviewed runtime grants are reapplied before file checks.
Review/reissue invitations
and notifications; do not replay historical reset links. Audit tables/history remain unchanged.
Use an encrypted disk for the restricted temporary plaintext restore directory; it is removed in
finally, but filesystem deletion is not guaranteed secure erasure. If extraction fails after the DB
restore, retain isolation and discard only that explicitly identified drill environment after review.

Reapply runtime grants as needed, rotate/reissue secrets without losing encrypted notification key
compatibility, verify tenant relations, ledger balances, authorized file streams, migrations and
authenticated browser workflows. Keep restored data private until operator signoff; never overwrite
the live database. `npm run test:restore-drill` exercises this path with fictional data only.

## Deployment, rollback, incident response and support

Deploy gate: clean install/quality + SQL checks + secret/SAST/container scans + restore evidence +
staging smoke + authenticated E2E + approved risks. Take encrypted backup, drain writers, run reviewed
migrations (history hashes/advisory lock), apply grants, start release, wait for ready, then allow traffic.
Reject edited migration history. Do not automatically run migrations from API startup.

Rollback: withdraw traffic, stop writers/worker, retain current volumes and audited history, restore
the previous **compatible** immutable code image. No destructive down migrations. If schema cannot
support older writers, keep maintenance mode and restore the verified backup to **new** isolated
volumes; review any post-backup writes before switching. Never downgrade the clinical safety freeze.

Incident: record UTC time, trace ID, symptom and impacted tenant count without clinical payloads;
assign incident commander. Contain public ingress or suspend affected memberships, preserve restricted
audit/log/backups, revoke compromised sessions and rotate exposed credentials. Do not erase evidence,
mass-delete patient records or publish images/tokens. Confirm scope from tenant-aware audit evidence,
involve the clinic/privacy/security owners and use jurisdiction-reviewed notification procedures.
Recover from verified artifacts, test isolation/authorization, document root cause and follow-up.
Never claim recovery from a guessed/incomplete backup.

Support: use least-privileged access, owner consent, trace IDs and reproducible fictional examples.
Do not request passwords, email verification links, session cookies, full X-rays or database exports
in normal support tickets. Escalate suspected cross-tenant access, missing histories, financial
reconciliation or clinical-safety violations immediately. Do not advise patient care from experimental
output. Track severity/owner/next-update time and validate restored behavior with the clinic owner.
