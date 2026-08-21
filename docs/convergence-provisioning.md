# Convergence provisioning

The installer safely provisions the configured daily R2 bucket and D1 database. It reuses resources with matching names on subsequent runs. Reinstalls preserve the persisted Worker name, Analytics Engine dataset, `EVENT_STREAM` Pipeline binding, and R2 SQL variables instead of replacing them with package defaults. After a successful deployment, it writes the deployed Wrangler configuration to `~/.noomers/wrangler.json` and resource metadata to `~/.noomers/deployment.json`. The `auth`, `env`, and `storage` commands use that installed configuration.

Pipeline and R2 Data Catalog setup is intentionally not automated. Current setup is interactive and requires an R2 API token with R2 and Data Catalog permissions.

Check existing pipelines:

```bash
npx wrangler@latest pipelines list
```

Run Cloudflare's documented interactive setup. Pipeline names may contain only letters, numbers, and underscores:

```bash
npx wrangler@latest pipelines setup --name noomers_events
```

Use these choices in the setup wizard:

1. Disable HTTP ingestion. noomers writes through a Worker binding.
2. Choose **Load from file** for the incoming schema and enter `packages/server/pipelines/events.schema.json`.
3. Choose **Iceberg** rather than a plain R2 destination.
4. Choose **Simple** setup (Parquet, Zstandard compression, and the recommended file-roll settings).
5. Select or create the intended R2 warehouse bucket.
6. Use table name `events`; the resulting table is `default.events`.
7. Enter an R2 API token with **Admin Read & Write** access so setup can enable and write to the Data Catalog. Enter the API token value, not its Access Key ID or Secret Access Key.
8. Choose **Simple ingestion** (`SELECT * FROM stream`).

The setup command creates the stream, sink, Pipeline, and table, and enables the bucket's catalog if needed. Add the emitted `pipelines` binding to the deployment's Wrangler configuration before redeploying, using the `stream` field with the stream ID (`{ "binding": "EVENT_STREAM", "stream": "<STREAM_ID>" }`). The binding **must** be named `EVENT_STREAM` (the runtime binding used by the collector); the installer reads stream metadata only from `EVENT_STREAM` and rejects stale `EVENTS_PIPELINE` bindings.

Pipelines schema type names are Arrow-oriented. In particular, boolean fields use `bool`, not `boolean`; the canonical schema already follows this requirement.

Check the catalog after setup:

```bash
npx wrangler@latest r2 bucket catalog get <BUCKET>
```

These commands follow the current Cloudflare Pipelines and R2 Data Catalog documentation. They require live Cloudflare authentication and cannot be validated offline.
