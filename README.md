# noomers

noomers is a privacy-first, self-hosted web analytics platform for Cloudflare: a lightweight tracker script, a realtime dashboard, and Plausible-compatible APIs — all running on your own Cloudflare account at near-zero cost.

_noomers is sponsored by [Modem, your dev-team's auto-triage PM](https://modem.dev)._

## What it does

- **Lightweight tracker** — a single `tracker.js` (ESM or UMD) script tag collects pageviews, custom events (with optional revenue), scroll/engagement signals, and campaign parameters.
- **Privacy by construction** — no cookies, no raw IPs or full user-agents persisted; visitor IDs are site-scoped, hostname-scoped, salted, and rotate daily in UTC.
- **Host-checked collection** — events are only counted when the Origin and page host match the site's registered domain or a subdomain. A non-browser client can still fake those headers; use the server tracker with `SERVER_EVENTS_TOKEN` for events that must be trustworthy. Collection is rate-limited per IP+site.
- **Realtime** — a per-site `SiteEvents` Durable Object buffers canonical events and serves live realtime aggregates over WebSocket.
- **Full history** — events go straight to [Cloudflare Basin](https://developers.cloudflare.com/basin/) (Pipelines → R2 → Iceberg → Basin SQL), so there is no fixed retention limit.
- **Dashboard** — a Better Auth–gated SPA at `app.<domain>` (single-owner; `OWNER_ADMIN_EMAIL`, or the first verified account if unset) with stats, timeseries, realtime, goals, and breakdown cards.
- **Plausible-compatible APIs** — a subset of Plausible's Sites and Stats APIs, plus a data-shape-compatible event model and importer. See [Plausible feature parity](docs/plausible-feature-parity.md) for the supported baseline — **not** full parity.

## Architecture

```
site visitor ──GET/POST /collect──▶ apps/web worker (Hono)
                                               │  - D1 site registry check (fail closed)
                                               │  - normalize + salt visitor id
                                               ▼
                                     ├── EVENT_STREAM Pipeline → R2 → Iceberg (Data Catalog)
                                     └── SiteEvents Durable Object (per site, realtime only)
                                               │
                                               ▼
                          Basin SQL  ←── /api/v2/query + /api/dashboard/*
```

`apps/web` serves the SPA and every worker route (`/api/*`, `/collect`, `/:script`, `/realtime/:siteId`, `/favicon`, `/cache`). `apps/site` is a static Astro site on the apex. `packages/tracker` builds the loader/module/server tracker bundles. `packages/brand` holds shared logo/tokens/fonts. `alchemy.run.ts` owns all infrastructure.

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

| Secret                                           | Purpose                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Deploy (needs Account API Tokens: Edit)                           |
| `OWNER_ADMIN_EMAIL`                              | Optional — first admin; if unset, first verified account is admin |
| `SITES_API_TOKEN`                                | Bearer for `/api/v1/*` (site management)                          |
| `STATS_API_TOKEN`                                | Bearer for `/api/v2/query` (and /api/v1 fallback)                 |
| `R2_SQL_TABLE`                                   | Query table (`noomers.events`)                                    |
| `R2_SQL_IMPORT_TABLE`                            | Optional imported-history table (see `scripts/plausible-import/`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`      | Optional Google OAuth                                             |
| `SIGNUP_DISABLED`                                | `true` closed, `false` open, empty = open until an admin exists   |
| `CF_TRACKER_SCRIPT_NAME`                         | Optional custom tracker script path                               |
| `SERVER_EVENTS_TOKEN`                            | Optional first-party server tracker token                         |

`BETTER_AUTH_SECRET`, `VISITOR_SALT`, the Basin SQL/Catalog tokens, `CF_ACCOUNT_ID`, and `R2_SQL_BUCKET` are minted or derived by `alchemy.run.ts` — they are not hand-managed secrets.

## Using the tracker

After deploy, `tracker.js` is served from `https://app.<your-domain>/tracker.js`. Add to your site:

```html
<script defer src="https://app.<your-domain>/tracker.js" data-site-id="example.com"></script>
```

Server-side tracking (including trusted IPs via `SERVER_EVENTS_TOKEN`) is available through `@noomers/tracker`'s server entry.

`tracker.js` records clicks on links to other hosts as `Outbound Link: Click` events with a `url` property (query string and fragment stripped); add `data-outbound="false"` to turn this off. Automated browsers (`navigator.webdriver`) are not tracked. To exclude your own visits, run `localStorage.noomers_ignore = "true"` in your browser console on your site.

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
- [docs/deploy.md](docs/deploy.md) — CI deploy, token permissions, secrets
- [docs/plausible-feature-parity.md](docs/plausible-feature-parity.md) — API capability coverage
- [docs/implementation-roadmap.md](docs/implementation-roadmap.md) — feature backlog

## License

noomers is free, open source software made available under the MIT license. See: [LICENSE](LICENSE).
