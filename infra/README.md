# Local infrastructure

Copy `infra/.env.example` to `infra/.env` and provide unique local-only credentials. There are no
default database or object-storage credentials in source control.

From the repository root:

```bash
npm run infra:config
npm run infra:up
```

The default stack starts PostgreSQL and private MinIO storage. The one-shot `minio-init` container
creates the configured bucket and explicitly disables anonymous access. Named volumes preserve local
data across container recreation.

The optional `npm run infra:up:ai` starts the private experimental inference service, not a fake
health-only analyzer. It does not enable API/browser inference. Missing models return unavailable.

Phase 14's separate `compose.pilot.yml` uses secret mounts, a restricted application DB identity and
private filesystem object storage. It does not reuse the development volumes or passwords.
See [pilot operations](../docs/phase14-operations.md) before starting it. `compose.drill.yml` exposes
only a random loopback DB port for disposable fixture drills; never use that overlay in production.
