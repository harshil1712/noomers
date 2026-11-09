# Contributing to noomers

noomers development is 100% volunteer-driven. If you use and like this software and want to see it improve, we encourage you to contribute with Issues or Pull Requests.

## Development

### Dependencies

Install dependencies from the repository root:

```bash
vp install
```

Install Playwright browsers (only needed for the tracker integration tests):

```bash
cd packages/tracker && pnpm playwright install
```

### Config

Local development (`vp run dev`, i.e. `alchemy dev`) needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` for your own Cloudflare account in the environment, plus `BETTER_AUTH_URL` pointing at the printed local URL. Verification and reset emails land in `.alchemy/local/email/`. Never put production credentials in `.dev.vars` — see `AGENTS.md` and `docs/deploy.md` for the full setup.

### Running the App

noomers is a pnpm monorepo on Vite+/TanStack Router (SPA) and a Hono API worker.

- `cd apps/web && vp dev` → Vite dev server for the SPA; worker routes need the worker dev server.
- `vp run dev` → `alchemy dev`: worker + D1 + Durable Object locally against your Cloudflare account.

Verification before every change: `vp check`, `vp run -r test`, `vp run -r build`.

## Development Philosophy

The primary goal of noomers is to be super easy to self-host and maintain. It should be "set up once and forget".

To achieve that:

- Application state lives in three places, all provisioned by `alchemy.run.ts`:
  - **D1** — the authoritative site registry, goals, custom properties, tombstones, and Better Auth tables (users, sessions). Collection fails closed against the D1 registry.
  - **The SiteEvents Durable Object** — per-site realtime buffer that ships canonical events to the Basin Pipeline and serves the live dashboard.
  - **Basin/Iceberg** — the durable event archive (`noomers.events`) that Basin SQL queries for all historical analytics; there is no fixed retention cap.
- We prioritize backwards compatibility
  - D1 migrations are append-only; never edit an applied migration.
  - Canonical event fields change only through coordinated updates to the collector, the Pipeline schema, the SQL layer, tests, and docs.
- Privacy invariants are non-negotiable: no raw IPs or full user agents, salted visitor IDs that rotate daily in UTC, and no cross-day/cross-site/cross-device identity linking.
