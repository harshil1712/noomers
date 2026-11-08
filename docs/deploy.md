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
| Account · Workers R2 Storage · Write           | the stage's warehouse bucket          |
| Account · Workers R2 Data Catalog · Write      | `noomers.events` Iceberg table (sink) |
| Account · Workers R2 SQL · Read                | minting the read-only Basin SQL token |
| Account · Cloudflare Workers KV Storage · Read | DO state inspection (optional)        |

### Additional secrets (noomers analytics)

`alchemy.run.ts` mints `BETTER_AUTH_SECRET`, `VISITOR_SALT`, the Basin SQL
token (`R2_SQL_TOKEN`) and the Data Catalog sink token, and derives
`CF_ACCOUNT_ID` and `R2_SQL_BUCKET` from the provisioned account and bucket —
none of these are secrets you set.

| Secret                   | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `SITES_API_TOKEN`        | Bearer for `/api/v1/*` (Plausible Sites API)                                       |
| `STATS_API_TOKEN`        | Bearer for `/api/v2/query` (and /api/v1 fallback)                                  |
| `SERVER_EVENTS_TOKEN`    | Optional first-party server tracker token                                          |
| `R2_SQL_TABLE`           | Basin SQL query table (`noomers.events`)                                           |
| `R2_SQL_IMPORT_TABLE`    | Optional imported-history table UNIONed into queries (`scripts/plausible-import/`) |
| `CF_TRACKER_SCRIPT_NAME` | Optional custom tracker script path                                                |

### Iceberg erasure

Deleting a site writes a `site_deletion_jobs` row. A scheduled workflow
(`.github/workflows/iceberg-erasure.yml`, daily at 03:17 UTC plus manual
`workflow_dispatch`) runs `scripts/iceberg-erasure/erase.py`, which fetches
due jobs (older than one hour) from `/api/maintenance/deletion-jobs`,
row-deletes the site's rows through Basin Catalog, verifies nothing is left,
and reports `completed`/`failed` back to the Worker. Managed snapshot
expiration on the Data Catalog (enabled in `alchemy.run.ts`) then removes
the data files the deleted snapshots no longer reference.

Secrets used: `SITES_API_TOKEN` (must exist in the production environment
for the workflow to run; it skips with a notice otherwise),
`CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID`. To run it by hand:
Actions → iceberg-erasure → Run workflow. Set the repo variable
`R2_SQL_BUCKET` to the deployed stage's warehouse bucket name.

## Cutover from the wrangler-based deployment

- **D1 `noomers-goals` is adopted by name.** Alchemy reuses the existing
  database and does not create a second one. Its own bookkeeping table is
  `__alchemy_migrations`; a database previously migrated by
  `wrangler d1 migrations apply` (wrangler's `d1_migrations` table) is
  converted one-way on first `alchemy deploy` — the wrangler table is left
  frozen and 0001–0007 are never re-applied.
- **Worker name changes** from the wrangler-era name to `noomers-web`.
  The old worker and its routes/custom domain are NOT removed
  automatically — verify `noomers-web` serves everything, then retire the
  old worker manually.
- **Pipelines are not adopted.** Stream, sink, pipeline, bucket, and token
  names are generated per stage, so the deploy provisions its own set.
  `R2_SQL_BUCKET` is bound from the provisioned bucket, so an old table is
  queryable only through `R2_SQL_TABLE`/`R2_SQL_IMPORT_TABLE` if it lives
  in the same bucket's catalog; otherwise history starts fresh.
- **Drain the SiteEvents DO first.** Unshipped buffered rows live in the
  old worker's DOs. Check `/api/health/ready` reports zero backlog on the
  old deployment before switching traffic, or those events are stranded.
- **Basin/R2 tokens are minted by the deploy** (`Account API Tokens · Edit`
  on the CI token grants this). The minted R2 SQL token is read-only —
  confirm the first real preview answers `/api/health/ready` before
  switching traffic. Wrangler-era `CF_PASSWORD_HASH`, `CF_JWT_SECRET`,
  `CF_AUTH_ENABLED` are gone — dashboard auth is Better Auth with
  `OWNER_ADMIN_EMAIL` — set it before the public URL is live, or the first stranger to sign up becomes admin.
- **New `VISITOR_SALT`.** Alchemy mints a fresh salt, so visitor IDs on the
  cutover day won't match pre-cutover ones. Visitor IDs rotate daily in UTC
  anyway, so the only effect is a one-day discontinuity in visitor counts.
