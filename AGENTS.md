# AGENTS.md

Guidance for coding agents working in this repository.

## Repository overview

noomers is a pnpm monorepo for self-hosted, privacy-first web analytics on Cloudflare, built on the fastflare template: a Vite/TanStack Router/Kumo SPA + Hono API worker, a static Astro marketing site, a shared brand package, a browser/server tracker package, and one Alchemy stack.

| Path                | Purpose                                                                                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`          | app.noomers.dev — SPA + Hono worker in `worker/`, D1 via repositories, Better Auth (email verification + Turnstile + admin plugin), the SiteEvents Durable Object, the Basin Pipeline binding, D1 migrations, Plausible-compatible APIs, tracker-script routes, and the admin dashboard. |
| `apps/site`         | noomers.dev apex — Astro static marketing site + blog.                                                                                                                                                                                                                                   |
| `packages/brand`    | noomers identity: wordmark logo, Kumo default theme (no custom colors/fonts).                                                                                                                                                                                                            |
| `packages/tracker`  | Browser loader (`tracker.js`), ESM browser package, and server-side tracking package.                                                                                                                                                                                                    |
| `alchemy.run.ts`    | All infrastructure (Alchemy IaC). No resource is created any other way.                                                                                                                                                                                                                  |
| `project.config.ts` | Single source for names/domains.                                                                                                                                                                                                                                                         |

Key references: `README.md` for user-facing behavior, `docs/plausible-feature-parity.md` before changing compatibility claims, `docs/deploy.md` for CI deploy.

## Toolchain

- Node.js 20 or newer. pnpm via Vite+ (`vp`), as pinned by `minimumReleaseAge: 10080` in `pnpm-workspace.yaml`. Do not introduce npm or Yarn lockfiles.
- Vite+ (`vp`) wraps package management, build (`vp build`), test (`vp test`), dev (`vp dev`), lint/format/typecheck (`vp check`), and task running (`vp run`).

Install dependencies from the repository root:

```bash
vp install
```

## Common commands

```bash
vp check            # format + lint (anti-slop) + typecheck — must be clean
vp run -r test      # all package tests (apps/web runs under @cloudflare/vitest-plugin)
vp run -r build     # all builds; copies tracker.js into apps/web/public
vp install --frozen-lockfile
```

Focused checks while iterating:

```bash
cd apps/web && TZ=EST vp test tests/dashboard.test.ts
cd packages/tracker && vp test
```

Tracker integration tests (Playwright) stay a separate `test:integration` script — browsers required, not part of `vp test`.

Local dev: `vp run dev` / `alchemy dev` works with `alchemy login` or an API token in env; point `BETTER_AUTH_URL` at the printed URL. Local dev has no Pipeline/Basin, so the dashboard shows realtime only and no history — end-to-end Basin testing needs a deployed dev stage (`vp run deploy:dev`). Verification/reset mail lands in `.alchemy/local/email/`. Never put production credentials in `.dev.vars`.

## Architecture

### Worker (`apps/web/worker`)

- `worker/index.ts` — Hono entry; exports the `SiteEvents` Durable Object class.
- `worker/analytics/` — collect, Plausible Events API, Stats API (`/api/v2/query`), Basin SQL (`r2-sql.ts`), bot filtering, tracker template.
- `worker/sites/`, `goals/`, `custom-properties/` — D1 repositories (**raw SQL**, documented exception to the Drizzle rule, same as Basin SQL).
- `worker/routes/` — Hono handlers: health/readiness, collect, Plausible events, `/api/v1/sites*`, `/api/v2/query`, tracker scripts, favicon/cache, `/api/dashboard/*`, realtime.
- `worker/realtime.ts` — `/realtime/:siteId` WebSocket; requires a Better Auth session with `role === "admin"`.
- `worker/site-events.ts` — per-site DO: buffers canonical events, ships them to `EVENT_STREAM`, serves realtime aggregates.
- `apps/web/migrations/` — ordered D1 migrations; `0001_init`/`0002_auth` are the baseline.

### Event data flow

1. Native `/collect` or Plausible-compatible `/api/event` receives an event.
2. D1 verifies that the site is active. Unknown, deleted, or unavailable registry states fail closed.
3. The collector normalizes URL, geography, user agent, campaign, event, and property fields.
4. A salted visitor identifier is generated and rotated daily in UTC.
5. The canonical event is recorded in the site's `SiteEvents` Durable Object (fail closed; a DO error returns 500).
6. The DO ships unsent rows to `EVENT_STREAM` (Basin pipeline → R2/Iceberg) with backoff and prunes shipped rows.
7. Dashboard and Stats API queries read Basin SQL over `noomers.events` (plus an optional import table); the DO serves only the realtime panel.
8. Deleting a site tombstones it and purges its DO immediately.

### Dashboard and auth

- Better Auth owns all auth: email+password with mandatory verification, Google OAuth (optional), Turnstile on sign-up/sign-in/reset, `SIGNUP_DISABLED` support.
- The dashboard is single-owner self-hosted: every dashboard surface (`/api/dashboard/*` and `/realtime/:siteId`) requires a session user with `role === "admin"`; `OWNER_ADMIN_EMAIL` bootstraps the first admin. Non-admin signed-in users get 403.
- Plausible APIs keep deployment-wide Bearer tokens (`SITES_API_TOKEN`, `STATS_API_TOKEN`); `SERVER_EVENTS_TOKEN` gates the server-tracker trust path.

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
- Do not claim complete erasure while Iceberg deletion is pending. The internal deletion job records state, but no automatic processor runs; Iceberg cleanup is manual.
- Never delete Iceberg objects directly with an R2 lifecycle rule. Row deletion must use a writable Iceberg-compatible engine followed by snapshot expiration and orphan cleanup.

### Analytics semantics

- Use half-open time ranges internally: `timestamp >= start AND timestamp < end`.
- Apply the site's IANA reporting timezone to date presets and time buckets.
- Visitor IDs rotate at UTC midnight, so sessions cannot safely cross that boundary.
- Do not implement Plausible `visit:*` dimensions by grouping event rows. Visit dimensions must use the first pageview of a reconstructed session; entry and exit dimensions require first/last pageview attribution.
- The SiteEvents DO is realtime-only; Basin SQL serves all history and can lag collection by a few minutes because the DO batches shipments.
- Do not silently approximate session metrics where the API promises exact R2 SQL results. Return a clear compatibility error instead.

### API compatibility

- Keep request validation closed and bounded: reject unknown keys, unsafe identifiers, oversized bodies, unsupported combinations, and unbounded result requests.
- Escape SQL values for Basin SQL. Never interpolate unvalidated identifiers.
- Preserve Plausible response shapes, status codes, normalized query echoes, and timezone behavior when extending compatibility routes.
- Add tests for both generated SQL dialects when changing dimensions, filters, metrics, or ordering.
- Do not advertise full Plausible parity. Update `docs/plausible-feature-parity.md` whenever a supported, partial, missing, deferred, or blocked capability changes.

## Database and schema changes

- D1 migrations are append-only. Add the next numbered migration; **never edit or rename `0001_init.sql`, `0002_auth.sql`, or any migration once a deployment has applied it** — Alchemy tracks applied migrations in `__alchemy_migrations` keyed on filename.
- Make migrations safe for fresh installs and upgrades from every supported prior schema.
- Update repository tests and migration expectations with every schema change.
- Changes to canonical event fields require coordinated updates to the collector, Pipeline schema (`apps/web/pipelines/events.schema.json`), handwritten durable/normalized event interfaces, R2 SQL, tests, and documentation.

## Generated and build artifacts

- Do not hand-edit `apps/web/public/tracker.js`; it is copied from the tracker build by the root build.
- Do not hand-edit `src/routeTree.gen.ts`, `src/auth-schema.ts` (Better Auth CLI output), or `apps/site/src/env.d.ts` module declarations.
- Do not edit `dist/`, `.alchemy/`, coverage output, or other generated output.

## Coding conventions

- Follow nearby TypeScript and React patterns rather than introducing a new abstraction style.
- Prefer small, typed functions and explicit validation at external boundaries.
- Keep Cloudflare bindings in request context; do not put request-specific mutable state in module globals.
- Await or deliberately register asynchronous Worker work with the execution context. Do not leave floating promises.
- Stream request/response bodies where practical and keep API body/result limits explicit.
- Place tests near the code under `__tests__` and cover success, validation, authorization, failure, and boundary behavior.
- Preserve existing changes in a dirty worktree. Do not revert unrelated files or generated output without confirming ownership.
- The anti-slop Oxlint plugin runs via `vp check`: no `vi.mock` (tests use real seams — service bindings, test env vars, injected factories), no unsafe `unknown` plumbing, no runtime `typeof` narrowing of representations.

## Hard rules

1. **Production safety.** Production changes only through a merged PR with green CI and a passing Worker Preview smoke test. Never deploy production from a laptop or a feature branch. Never create Cloudflare resources outside `alchemy.run.ts`.
2. **Dependencies.** 7-day rule (`minimumReleaseAge: 10080`). Never add exclusions or weaken it; report the blocker. Use `vp add`/`vp remove`, never hand-edit versions to unvetted releases.
3. **Secrets.** Never commit, log or print secrets. Ask the human for new ones.
4. **Verification before done**: `vp check` → `vp run -r test` → `vp run -r build`; UI changes need screenshots (`verify-ui`). Never claim a check passed without running it in this session.
5. **No hook bypass.** Never `--no-verify`, never force-push `main`, never rewrite published history.
6. **Database.** Drizzle ORM only for new tables — **except** the analytics repositories (`worker/sites/`, `goals/`, `custom-properties/`, sessions/deletion state) and Basin SQL, which stay raw SQL by deliberate exception. Auth tables come from the Better Auth schema. Migrations in `apps/web/migrations` are hand-maintained SQL.
7. **Clean up after yourself.** Before reporting done: stop dev servers/browsers you started, remove scratch files/debug logging, leave `git status` clean. Follow `cleanup`.

## Cloudflare and deployment safety

- Do not deploy, create resources, apply remote migrations, rotate secrets, or modify a live Cloudflare account unless the user explicitly asks.
- The `cd` workflow is manual-only and never deploys; real deploys happen via the PR preview/production workflows documented in `docs/deploy.md`.
- Never commit `.dev.vars`, API tokens, passwords, salts, R2 SQL credentials, or files under `~/.noomers/`.
- Pipeline/Data Catalog provisioning is Alchemy-owned in `alchemy.run.ts`.
- Use `EVENT_STREAM` consistently as the runtime Basin Pipeline binding; `SITE_EVENTS` is the per-site Durable Object; `DB` is the sole D1 binding; `COLLECT_RATE_LIMIT` (ns 1001) throttles collection, `RATE_LIMITER` (ns 1002) throttles auth.
- Treat `/api/health` as a compatibility liveness response, not proof that D1, the DO, the Pipeline, or Basin SQL is healthy — `/api/health/ready` is the readiness signal.

## Design skills

| Task                        | Skill                                                    |
| --------------------------- | -------------------------------------------------------- |
| New page/screen (esp. site) | `frontend-design` for direction, then `kumo-ui` to build |
| Any apps/web UI             | `kumo-ui`                                                |
| Tokens/branding/fonts       | `brand-tokens`                                           |
| Motion/interaction          | `emil-design-eng` (no Framer Motion — CSS/WAAPI only)    |
| Design review/polish        | `impeccable` (+ `npx impeccable detect`)                 |
| Site/blog/UI copy           | `copywriting`, `copy-editing`; blog posts → `write-post` |
| Before any UI PR            | `verify-ui`                                              |

**Precedence:** project skills (`kumo-ui`, `brand-tokens`, `write-post`, `verify-ui`) and this file beat vendored skills — e.g. a vendored skill suggesting `dark:` classes, raw palette colors, new fonts or a new UI library is wrong here.

## Decisions — don't re-propose

- **SPA, not SSR.** The app is a Vite single-page app; the worker serves assets + worker routes (`runWorkerFirst`, with `!/assets/*` negative pattern). No TanStack Start, no server rendering.
- **Astro for marketing** (`apps/site`), static output, separate worker on the apex.
- **Alchemy v2** (Effect style) owns all infra — no wrangler config files for deploy, no Terraform.
- **Kumo UI** (`@cloudflare/kumo`) + Phosphor icons + Tailwind 4. No other component library; `cn()` comes from `@cloudflare/kumo`.
- **Charts:** Kumo `TimeseriesChart` + consumer-installed `echarts` (no recharts).
- **Better Auth** for all auth; admin plugin + `OWNER_ADMIN_EMAIL` gate the dashboard.
- **No `vi.mock`** — the anti-slop plugin forbids module mocking; tests use real seams.
- **No generic agent API/MCP.** `/api/v1/*` belongs to the Plausible Sites API. An agent surface may come later as a deliberate project, not the template's flow.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run `vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use `vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
