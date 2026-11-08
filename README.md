# noomers

noomers is a privacy-first, self-hosted web analytics platform for Cloudflare: a lightweight tracker script, a realtime dashboard, and Plausible-compatible APIs — all running on your own Cloudflare account at near-zero cost.

_noomers is sponsored by [Modem, your dev-team's auto-triage PM](https://modem.dev)._

## What it does

- **Lightweight tracker** — a single `tracker.js` (ESM or UMD) script tag, plus Plausible-compatible `pa-*.js` script routes, collects pageviews, custom events, scroll/engagement signals, and campaign parameters.
- **Privacy by construction** — no cookies, no raw IPs or full user-agents persisted; visitor IDs are site-scoped, hostname-scoped, salted, and rotate daily in UTC.
- **Realtime** — a per-site `SiteEvents` Durable Object buffers canonical events and serves live realtime aggregates over WebSocket.
- **Full history** — the DO ships durable events to [Cloudflare Basin](https://developers.cloudflare.com/basin/) (Pipelines → R2 → Iceberg → Basin SQL), so there is no fixed retention limit.
- **Dashboard** — a Better Auth–gated SPA at `app.<domain>` (single-owner; the first verified `OWNER_ADMIN_EMAIL` becomes admin) with stats, timeseries, realtime, goals, and breakdown cards.
- **Plausible-compatible APIs** — a subset of Plausible's Events, Sites, and Stats APIs. See [Plausible feature parity](docs/plausible-feature-parity.md) for the supported baseline — **not** full parity.

## Architecture

```
site visitor ──GET /collect or POST /api/event──▶ apps/web worker (Hono)
                                               │  - D1 site registry check (fail closed)
                                               │  - normalize + salt visitor id
                                               ▼
                                     SiteEvents Durable Object (per site)
                                               │  - buffers events (realtime)
                                               │  - ships unsent rows →
                                               ▼
                           EVENT_STREAM Pipeline → R2 → Iceberg (Data Catalog)
                                               │
                                               ▼
                          Basin SQL  ←── /api/v2/query + /api/dashboard/*
```

`apps/web` serves the SPA and every worker route (`/api/*`, `/collect`, `/js/*`, `/:script`, `/realtime/:siteId`, `/favicon`, `/cache`). `apps/site` is a static Astro site on the apex. `packages/tracker` builds the loader/module/server tracker bundles. `packages/brand` holds shared logo/tokens/fonts. `alchemy.run.ts` owns all infrastructure.

## Getting started (self-host)

### Requirements

- Node 20+, pnpm (via [Vite+](https://viteplus.dev) `vp`)
- A Cloudflare account with a Workers subdomain and a zone for the app domain

### Configure

1. Fork/clone this repo, run `vp install`.
2. Edit `project.config.ts` for your domain/product names.
3. In `alchemy.run.ts`, set the vars/secrets you need (see the table below and `docs/deploy.md` for the token permissions).
4. Deploy via a merged PR — the `deploy` GitHub workflow runs `alchemy deploy` from `main`; PRs get Worker Previews. **No local `alchemy deploy`.**

### Secrets (GitHub environment `production`)

| Secret                                           | Purpose                                           |
| ------------------------------------------------ | ------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Deploy (needs Account API Tokens: Edit)           |
| `OWNER_ADMIN_EMAIL`                              | First admin bootstrap (verified email match)      |
| `SITES_API_TOKEN`                                | Bearer for `/api/v1/*` (site management)          |
| `STATS_API_TOKEN`                                | Bearer for `/api/v2/query` (and /api/v1 fallback) |
| `R2_SQL_TABLE`                                   | Query table (`noomers.events`)                    |
| `R2_SQL_IMPORT_TABLE`                            | Optional table UNIONed into queries               |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`      | Optional Google OAuth                             |
| `SIGNUP_DISABLED`                                | Optional — closes new sign-ups                    |
| `CF_TRACKER_SCRIPT_NAME`                         | Optional custom tracker script path               |
| `SERVER_EVENTS_TOKEN`                            | Optional first-party server tracker token         |

`BETTER_AUTH_SECRET`, `VISITOR_SALT`, the Basin SQL/Catalog tokens, `CF_ACCOUNT_ID`, and `R2_SQL_BUCKET` are minted or derived by `alchemy.run.ts` — they are not hand-managed secrets.

## Using the tracker

After deploy, `tracker.js` is served from `https://app.<your-domain>/tracker.js`. Add to your site:

```html
<script defer src="https://app.<your-domain>/tracker.js" data-site-id="example.com"></script>
```

Or use the Plausible-style route (`pa-*.js` per registered site) and server-side tracking via `@noomers/tracker`'s server entry.

## Local development

```bash
vp install
cd apps/web && vp dev   # vite dev (SPA only; worker calls need alchemy dev)
# or, with your own CF account creds in env:
vp run dev              # alchemy dev — worker + D1 + DO locally
                        # (no Pipeline/Basin: realtime only, no history)
```

Verification before every change: `vp check`, `vp run -r test`, `vp run -r build`.

## Documentation

- [AGENTS.md](AGENTS.md) — repo rules and invariants
- [docs/deploy.md](docs/deploy.md) — CI deploy, token permissions, secrets, wrangler cutover
- [docs/plausible-feature-parity.md](docs/plausible-feature-parity.md) — API capability coverage
- [docs/implementation-roadmap.md](docs/implementation-roadmap.md) — feature backlog

## License

noomers is free, open source software made available under the MIT license. See: [LICENSE](LICENSE).
