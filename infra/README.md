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

To include the placeholder AI health service, run `npm run infra:up:ai`. This does not enable or expose
an inference endpoint.
