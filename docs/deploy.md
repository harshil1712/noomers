# Deploy setup

CI runs `alchemy deploy`. The root `deploy`/`deploy:dev` scripts exist for CI
parity — `deploy` sets `ALCHEMY_STAGE=prod`, which `alchemy.run.ts` needs to
provision prod resources (custom domains, the real Turnstile widget, the email
sending subdomain). They are **not** a manual deploy path: production still
ships only through a merged PR (see `deploy` skill / AGENTS.md rule 1).

Production secrets go in the GitHub `production` environment
(restricted to `main`); preview secrets are repository secrets. An environment secret
overrides a repository secret of the same name, so both tokens are `CLOUDFLARE_API_TOKEN`.

Two account-owned Cloudflare API tokens (Manage Account → Account API Tokens). Put the
Account permissions in a policy whose resource is the account and the Zone permissions in a
separate policy on your zone; account permissions inside a zone policy grant nothing.
`scripts/cf-token-preflight.sh` (first deploy step) names any missing permission.

| Permission                                     | Production | Preview |
| ---------------------------------------------- | ---------- | ------- |
| Account · Workers Scripts · Write              | ✓          | ✓       |
| Account · D1 · Write                           | ✓          | ✓       |
| Account · Workers R2 Storage · Write           | ✓          | ✓       |
| Account · Secrets Store · Write                | ✓          | ✓       |
| Account · Account API Tokens · Edit            | ✓          | ✓       |
| Account · Cloudflare Turnstile · Write         | ✓          | —       |
| Account · Email Sending · Write                | ✓          | —       |
| Zone `<domain>` · Workers Routes · Write       | ✓          | —       |
| Zone `<domain>` · Zone · Read                  | ✓          | —       |
| Zone `<domain>` · Dynamic URL Redirects · Edit | ✓          | —       |

Use **Workers Scripts · Write** even though the dashboard labels it Legacy (no deprecation
date; Cloudflare promises advance notice), not the new Workers Admin/Editor roles: per
Cloudflare's API spec, custom domains, static-asset upload sessions and Worker Previews
accept only Workers Scripts Write. Secrets Store is for Alchemy's state store
(`alchemy-state-store`). No DNS permission is needed (custom domains create their own records).

| Secret                                      | Scope                                                                         | Notes                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`                      | see the token table above                                                     | prod: environment; preview: repo              |
| `CLOUDFLARE_ACCOUNT_ID`                     | Account ID (dashboard → overview)                                             |                                               |
| `CLOUDFLARE_ZONE_ID`                        | Zone ID for the apex domain                                                   | Prod only — Turnstile + Email                 |
| `WORKERS_DEV_SUBDOMAIN`                     | your `*.workers.dev` subdomain                                                | Used to build preview URLs                    |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client; redirect `https://app.<domain>/api/auth/callback/google` | Optional — empty disables Google              |
| `OWNER_ADMIN_EMAIL`                         | verified owner email for admin bootstrap                                      | Set it — else the first sign-up becomes admin |
| `SIGNUP_DISABLED`                           | `production` **variable** (not secret) — `true` closed, `false` always open   | Optional — unset closes once an admin exists  |

**First deploy:** a new project's first PR can't get a Worker Preview —
previews are versions of the production Workers, which don't exist until the
first merge to main deploys them. Merge the first PR on green CI; every later
PR gets a preview.

Alchemy state lives in the account (`Cloudflare.state()`: the `alchemy-state-store` Worker
plus its Secrets Store secrets), so no extra state secrets are needed.

PR previews need only `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` + `WORKERS_DEV_SUBDOMAIN`.

## noomers resources

On top of the table above the deploy token also needs, because
`alchemy.run.ts` provisions the analytics pipeline:

| Permission                                     | Why                                   |
| ---------------------------------------------- | ------------------------------------- |
| Account · Pipelines · Write                    | `EVENT_STREAM` stream, sink, pipeline |
| Account · Workers R2 Data Catalog · Write      | `noomers.events` Iceberg table (sink) |
| Account · Workers R2 SQL · Read                | minting the read-only Basin SQL token |
| Account · Cloudflare Workers KV Storage · Read | DO state inspection (optional)        |

### Additional secrets (noomers analytics)

`alchemy.run.ts` mints `BETTER_AUTH_SECRET`, `VISITOR_SALT`, the Basin SQL
token (`R2_SQL_TOKEN`) and the Data Catalog sink token, and derives
`CF_ACCOUNT_ID` and `R2_SQL_BUCKET` from the provisioned account and bucket —
none of these are secrets you set.

Set `SITES_API_TOKEN` and `STATS_API_TOKEN` to long random values (e.g.
`openssl rand -hex 32`).

| Name                     | Kind                                        | Purpose                                                                   |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------- |
| `SITES_API_TOKEN`        | `production` environment secret             | Bearer for `/api/v1/*` (Plausible Sites API)                              |
| `STATS_API_TOKEN`        | `production` environment secret             | Bearer for `/api/v2/query` (and /api/v1 fallback)                         |
| `SERVER_EVENTS_TOKEN`    | `production` environment secret             | Optional first-party server tracker token                                 |
| `R2_SQL_IMPORT_TABLE`    | `production` environment variable, optional | Imported-history table UNIONed into queries (`scripts/plausible-import/`) |
| `CF_TRACKER_SCRIPT_NAME` | `production` environment variable, optional | Custom tracker script path                                                |

### Iceberg erasure

Basin SQL is read-only, so deleting a site's history is a manual command
run by the owner after deleting the site in the dashboard:

```sh
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... R2_SQL_BUCKET=...   uv run scripts/iceberg-erasure/erase.py <domain>
```

The API token needs Basin Catalog Write + R2 Storage Write.
`R2_SQL_BUCKET` is the stage's warehouse bucket — find it in the R2
dashboard (the prod bucket is `noomers-noomers-warehouse-prod-qut55meehfd2yq56`).
The command counts the site's rows, asks for confirmation (`--yes` skips),
row-deletes them through Basin Catalog, and verifies nothing is left.
Managed snapshot expiration on the Data Catalog (enabled in
`alchemy.run.ts`) then removes the data files.

## Before going live

- Events are accepted only after `EVENT_STREAM.send` confirms ingest — if
  Pipelines is down collection returns 500 and the tracker does not retry,
  so those events are lost.
- After the first deploy, check `https://app.<domain>/api/health/ready`
  returns `ready` before pointing real sites at it.
- Set `OWNER_ADMIN_EMAIL` before the public URL is live, or the first
  stranger to sign up becomes admin.
- Optional: if a site sees collection abuse, add a Cloudflare WAF
  rate-limiting rule on `/collect` and `/api/event` (not provisioned).
