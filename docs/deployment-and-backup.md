# Local deployment, reset and backup

Follow the root README's generated configuration and `infra:up:local` / `dev:seed` flow.
The offline Compose stack has PostgreSQL only; private filesystem storage/mail are explicitly
selected by generated configuration. The separate existing `infra:up` S3/MinIO stack remains an
option after filling every field in `infra/.env` and reviewing access policy. These are different
Compose projects/volumes; do not assume one command starts or stops the other.

Never use development identities/passwords, local mail or seeded fictional data in production.
Production needs HTTPS, real SMTP, fresh secrets, restricted DB roles, private encrypted storage
and a reviewed clinical/security deployment policy. Private files are not web assets. Windows
operators must restrict configuration, credential/mail files, volumes and backups with OS ACLs.

## Safe development reset

This is a new synthetic database, not import or conversion of legacy records. Retain the previous
database and matching private object directory. With the generated local stack running:

```bash
docker compose --env-file infra/.env -f infra/compose.local.yml exec -T postgres sh -ec 'createdb -U "$POSTGRES_USER" dentalai_test_reset_v2'
```

Manually change only the database name in ignored root `DATABASE_URL` to `dentalai_test_reset_v2`
and set `PRIVATE_STORAGE_DIRECTORY` to a new absolute private directory, such as `.local/private-objects-v2`.
Preserve the old configuration privately if rollback is needed. Then:

```bash
npm run dev:seed
npm run dev:seed
npm run dev
```

Reseeding is add-only and does not reset modified history/passwords. An existing default tenant with
another currency or identity fails; never force it or relabel USD records as SYP. There is no
automatic drop-database or volume-erasure command. Use normal password reset for existing accounts;
the seed never imports cloud passwords, hashes, tokens or sessions.

## Backup and restore policy

Before changing an existing self-hosted deployment, pause writes and stop background workers.
Create a PostgreSQL custom-format dump using `pg_dump --format=custom --file=<private-backup-path>`
against the server-only connection (prefer a protected `PGPASSFILE`, not passwords on a command line).
Copy the matching private object tree or create a versioned private S3 snapshot. Record SHA-256
checksums, database migration version, object counts and configuration/adapter version in a private
manifest. Encrypt/restrict both backups; they may include clinical history and opaque session tokens.
Do not commit dumps, objects, credentials or private mail tokens.

Restore with `pg_restore --exit-on-error` into a **new empty database**, restore the matching object
directory/snapshot and configure an isolated application instance. Check readiness, tenant relations,
financial reconciliation, object counts/checksums and authorized/private streams. Do not connect
restored expired sessions to a public instance; rotate secrets and review session revocation as needed.
Only switch after a restore test and operator approval. Local verification does not certify a real
deployment backup; no source cloud backup was obtainable under the approved disposable-data reset.

No destructive down migrations are supplied. Code rollback must retain current historical tables,
audits, ledgers and objects and block incompatible writers. Recover pre-removal source from tag
`checkpoint/phase12-pre-test-reset-20261009` in a separate checkout for inspection only; never deploy
it to restore public image access or randomized browser inference. Revoking/deleting a former hosted
project is a separate operator action, not a prerequisite for the now-independent local runtime.
