# Convergence provisioning

The installer safely provisions the configured daily R2 bucket and D1 database. It reuses resources with matching names on subsequent runs. After a successful deployment, it writes the deployed Wrangler configuration to `~/.noomers/wrangler.json` and resource metadata to `~/.noomers/deployment.json`. The `auth`, `env`, and `storage` commands use that installed configuration.

Pipeline and R2 Data Catalog setup is intentionally not automated. Current setup is interactive and requires an R2 API token with R2 and Data Catalog permissions.

Check existing pipelines:

```bash
npx wrangler@latest pipelines list
```

Run Cloudflare's documented interactive setup, using `packages/server/pipelines/events.schema.json` when prompted to load a schema from a file:

```bash
npx wrangler@latest pipelines setup --name noomers-events
```

Choose a Data Catalog (Iceberg) sink, simple setup, the intended R2 bucket, table `events`, and simple ingestion. The setup command creates the bucket and enables its catalog if needed. Add the emitted `pipelines` binding to the deployment's Wrangler configuration before redeploying. The binding **must** be named `EVENT_STREAM` (the runtime binding used by the collector); the installer reads pipeline metadata only from `EVENT_STREAM` and rejects stale `EVENTS_PIPELINE` bindings.

Check the catalog after setup:

```bash
npx wrangler@latest r2 bucket catalog get <BUCKET>
```

These commands follow the current Cloudflare Pipelines and R2 Data Catalog documentation. They require live Cloudflare authentication and cannot be validated offline.
