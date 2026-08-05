# AGENTS.md

Guidance for coding agents working in this repository.

## Repository overview

Counterscale is a pnpm/Turborepo monorepo for self-hosted web analytics on Cloudflare.

| Package                  | Purpose                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `packages/server`        | React Router application, Worker entry point, dashboard, APIs, D1 migrations, Pipeline schema, and scheduled rollups. |
| `packages/tracker`       | Browser loader, ESM browser package, and server-side tracking package.                                                |
| `packages/cli`           | Installer and deployment-management CLI built around Wrangler.                                                        |
| `packages/eslint-config` | Shared ESLint configuration.                                                                                          |

Read `README.md` for user-facing behavior, `docs/plausible-feature-parity.md` before changing compatibility claims, `docs/implementation-roadmap.md` before planning feature work, and `docs/convergence-provisioning.md` before changing durable-event provisioning.

## Toolchain

- Node.js 20 or newer.
- pnpm 9, as pinned by the root `packageManager` field.
- TypeScript, Vitest, Playwright, ESLint, Prettier, Vite, Turbo, React Router, and Wrangler.
- Use pnpm. Do not introduce npm or Yarn lockfiles.

Install dependencies from the repository root:

```bash
pnpm install
```

## Common commands

Run full repository checks from the root:

```bash
pnpm build
pnpm lint
pnpm turbo typecheck
pnpm turbo test
```

The CI-equivalent command is:

```bash
pnpm turbo build lint typecheck test-ci --concurrency=1
```

Tracker integration tests require Playwright browsers:

```bash
pnpm --filter @counterscale/tracker exec playwright install --with-deps
```

Prefer focused checks while iterating:

```bash
pnpm --filter @counterscale/server test -- app/routes/__tests__/api.v2.query.test.ts
pnpm --filter @counterscale/server typecheck
pnpm --filter @counterscale/cli test
pnpm --filter @counterscale/tracker exec vitest run
```

For local server development, create the ignored development-variable file from the example, use non-production values, and start only the server package:

```bash
cp packages/server/.dev.vars.example packages/server/.dev.vars
pnpm --filter @counterscale/server dev
```

Preview a production build with `pnpm turbo preview`. Never put production credentials in `.dev.vars`.

Before finishing a cross-package change, run the relevant package tests and typechecks, the root build, and `git diff --check`. Lint currently reports existing warnings; do not introduce new lint errors or warnings in edited code.

## Architecture

### Server

- `packages/server/workers/app.ts` is the Cloudflare Worker fetch and scheduled-event entry point.
- `packages/server/app/routes/` contains React Router UI and API routes.
- `packages/server/app/analytics/collect.ts` normalizes and writes events.
- `packages/server/app/analytics/query.ts` contains dashboard Analytics Engine queries.
- `packages/server/app/analytics/stats-api.ts` implements the Plausible Stats API compatibility layer.
- `packages/server/app/analytics/r2-sql.ts` reconstructs durable metrics and 30-minute sessions.
- `packages/server/app/sites/`, `goals/`, and `custom-properties/` own D1 persistence.
- `packages/server/migrations/` contains ordered D1 migrations.
- `packages/server/pipelines/events.schema.json` defines canonical durable events.

### Event data flow

1. Native `/collect` or Plausible-compatible `/api/event` receives an event.
2. D1 verifies that the site is active. Unknown, deleted, or unavailable registry states fail closed.
3. The collector normalizes URL, geography, user agent, campaign, event, and property fields.
4. A salted visitor identifier is generated and rotated daily in UTC.
5. Realtime fields are written to Analytics Engine.
6. The complete canonical event is optionally sent through `EVENT_STREAM` to Pipeline/Iceberg.
7. Dashboard queries use Analytics Engine, while exact Stats API session metrics require R2 SQL.

## Non-negotiable invariants

### Privacy

- Never persist raw IP addresses or full user-agent strings.
- Keep visitor identifiers site-scoped, hostname-scoped, salted, and daily rotating.
- Do not add cross-day, cross-site, or cross-device identity linking.
- Strip ordinary query parameters and sensitive referrer query data unless a documented campaign field requires them.
- Treat event properties as potentially sensitive. Do not log payloads, secrets, IPs, or identifiers.

### Collection and deletion

- Collection must remain fail closed against the authoritative D1 site registry.
- A deleted site's tombstone is permanent unless a deliberate product migration says otherwise.
- Site deletion must continue blocking collection, Stats API access, and re-registration immediately.
- Do not claim complete erasure while Analytics Engine expiry or Iceberg deletion is pending. Daily-rollup cleanup is currently unimplemented and is not represented in deletion-job state.
- Never delete Iceberg objects directly with an R2 lifecycle rule. Row deletion must use a writable Iceberg-compatible engine followed by snapshot expiration and orphan cleanup.

### Analytics semantics

- Use half-open time ranges internally: `timestamp >= start AND timestamp < end`.
- Apply the site's IANA reporting timezone to date presets and time buckets.
- Visitor IDs rotate at UTC midnight, so sessions cannot safely cross that boundary.
- Do not implement Plausible `visit:*` dimensions by grouping event rows. Visit dimensions must use the first pageview of a reconstructed session; entry and exit dimensions require first/last pageview attribution.
- Analytics Engine is realtime and retention-limited. R2/Iceberg is durable but can lag because Pipeline batches events.
- Do not silently approximate session metrics where the API promises exact R2 SQL results. Return a clear compatibility error instead.

### API compatibility

- Keep request validation closed and bounded: reject unknown keys, unsafe identifiers, oversized bodies, unsupported combinations, and unbounded result requests.
- Escape SQL values separately for Analytics Engine and R2 SQL. Never interpolate unvalidated identifiers.
- Preserve Plausible response shapes, status codes, normalized query echoes, and timezone behavior when extending compatibility routes.
- Add tests for both generated SQL dialects when changing dimensions, filters, metrics, or ordering.
- Do not advertise full Plausible parity. Update `docs/plausible-feature-parity.md` whenever a supported, partial, missing, deferred, or blocked capability changes.

## Database and schema changes

- D1 migrations are append-only. Add the next numbered migration; never edit a migration that may have been applied remotely.
- Make migrations safe for fresh installs and upgrades from every supported prior schema.
- Update repository tests and installer migration expectations with every schema change.
- Changes to canonical event fields require coordinated updates to the collector, Pipeline schema, handwritten durable/normalized event interfaces, R2 SQL, tests, and documentation.
- Analytics Engine column positions are a persisted schema contract. Do not repurpose an existing blob or double mapping.

## Generated and build artifacts

- Do not hand-edit `packages/server/public/tracker.js`; it is copied from the tracker build.
- Do not hand-edit `packages/server/worker-configuration.d.ts`; regenerate it with the server `types:gen` script when Wrangler bindings change.
- Do not edit `build/`, `dist/`, coverage output, or Turbo cache contents.
- A root build regenerates the ignored copied tracker artifact. Leave it uncommitted; do not force-add it.

## Coding conventions

- Follow nearby TypeScript and React patterns rather than introducing a new abstraction style.
- Prefer small, typed functions and explicit validation at external boundaries.
- Keep Cloudflare bindings in request context; do not put request-specific mutable state in module globals.
- Await or deliberately register asynchronous Worker work with the execution context. Do not leave floating promises.
- Stream request/response bodies where practical and keep API body/result limits explicit.
- Use four-space indentation and run Prettier on edited Markdown, JSON, and source files.
- Place tests near the code under `__tests__` and cover success, validation, authorization, failure, and boundary behavior.
- Preserve existing changes in a dirty worktree. Do not revert unrelated files or generated output without confirming ownership.

## Cloudflare and deployment safety

- Do not deploy, create resources, apply remote migrations, rotate secrets, or modify a live Cloudflare account unless the user explicitly asks.
- Do not push to `main` or `v3` without explicit production-deployment authorization. The `cd` workflow deploys after a completed CI workflow on those branches and currently does not check whether CI succeeded.
- Never commit `.dev.vars`, API tokens, passwords, salts, R2 SQL credentials, or files under `~/.counterscale/`.
- Load Cloudflare and Wrangler guidance before changing Worker bindings or running Wrangler commands.
- Pipeline/Data Catalog setup is currently interactive and credential-dependent. Keep manual and automated provisioning paths clearly distinguished.
- Use `EVENT_STREAM` consistently as the runtime Pipeline binding.
- Treat `/api/health` as a compatibility liveness response, not proof that D1, Analytics Engine, Pipeline, or R2 SQL is healthy.

## Completion checklist

- The smallest correct implementation is in place.
- Relevant unit and integration tests pass.
- Relevant package typechecks pass.
- Root build passes for cross-package changes.
- Lint has no new findings.
- `git diff --check` passes.
- Migrations, generated artifacts, examples, and environment types are synchronized.
- README and parity documentation match actual behavior and clearly identify infrastructure-dependent functionality.
