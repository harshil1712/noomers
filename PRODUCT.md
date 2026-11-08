# Product brief

## Product

- **Name:** noomers (`noomers.com`, app on `app.noomers.com`)
- **What it is:** a privacy-first, self-hosted web analytics platform for Cloudflare. Users deploy it to their own Cloudflare account, drop a script tag on their site, and get realtime + full-history analytics without handing visitor data to a third party.
- **What it also is:** a Plausible-compatible API surface — a subset of the Events, Sites, and Stats APIs (see `docs/plausible-feature-parity.md`; never claim full parity).

## Audience

- **Primary user:** developers self-hosting their analytics — privacy-conscious site owners who want Cloudflare-scale infra without SaaS analytics bills or data sharing.
- **Deployment model:** single-owner. One admin (Better Auth, `OWNER_ADMIN_EMAIL` bootstrap) owns the dashboard and all registered sites; sign-ups can be closed with `SIGNUP_DISABLED`.
- **Job to be done:** know who's visiting, from where, on what — with cookies-free, IP-free tracking and data that stays in the owner's own account.

## What it ships

- Tracker: `tracker.js` loader + ESM/UMD bundles + server-side tracking package; Plausible `pa-*.js` script routes.
- Collection: `/collect` (native) + `/api/event` (Plausible Events API), fail-closed on the D1 site registry, bot filtering, campaign/UTM + custom event properties.
- Realtime: per-site SiteEvents Durable Object; `/realtime/:siteId` WebSocket into the dashboard.
- History: Basin Pipeline → R2 → Iceberg, queried through Basin SQL; optional import table UNION.
- APIs: Plausible Sites API (`/api/v1/*`), Stats API (`/api/v2/query`), goal/custom-prop management — deployment-wide Bearer tokens.
- Dashboard: admin-gated SPA — stats, timeseries, realtime, goals, paginated breakdown cards, URL-driven filters.
- Auth: Better Auth (email verification required, optional Google sign-in, Turnstile, per-IP auth rate limiting, admin plugin).
- Infra: all in `alchemy.run.ts`; PR previews; production deploys from main with smoke tests; Workers Observability.

## Positioning

- Cloudflare-native end to end (Workers, D1, Durable Objects, Pipelines, R2/Iceberg, Basin SQL, Turnstile, Email).
- Privacy guarantees are architecture, not policy: salted daily-rotating visitor IDs, no raw IP/UA persistence, no cross-day/site/device linking.
- Self-hosted = data sovereignty: events never leave the owner's Cloudflare account.

## Non-goals

- Multi-tenant/billing/team features, scoped API keys, full Plausible parity, a hosted SaaS offering.
