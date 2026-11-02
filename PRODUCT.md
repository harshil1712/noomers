# Product brief

## Product

- **Name:** noomers (`noomers.dev`, app on `app.noomers.dev`)
- **What it is:** a paid full-stack SaaS template for Cloudflare. Buyers get a working monorepo, rename it with one command, and start on their own product instead of the plumbing.
- **What it also is:** the base the owner uses for every new project of their own.

## Audience

- **Primary buyer:** developers, indie hackers and small teams starting a new SaaS on Cloudflare. Technically fluent; they read code before they buy and distrust marketing claims.
- **Job:** skip weeks of setup (auth, database, admin, deploys, SEO) without inheriting a mess they have to delete first.
- **End users of a product built on it:** whoever the buyer serves; the template's app UI must look like a credible real product, not a demo.

## What it ships (confirmed)

- Auth: email/password with required verification, password reset, optional Google sign-in, Turnstile on auth forms, per-IP rate limiting.
- Admin area: users, roles, bans, session revocation.
- Data: D1 + Drizzle; one config file (`project.config.ts`) for names and domains; `scripts/init.ts` renames the whole repo.
- Infra: everything in `alchemy.run.ts`; per-PR preview deployments; production deploys from main with smoke tests and automatic rollback; Workers Observability.
- Marketing site + Markdown blog built for search and answer engines (JSON-LD, RSS, sitemap, `llms.txt`, an SEO check that runs in CI).
- Agent-first development: AGENTS.md, project skills, design and copy skills, an anti-slop lint plugin.
- **Planned (in progress):** a demo resource (Projects), API keys, an OpenAPI 3.1 spec and docs, and a remote MCP server so the buyer's product can be used by AI agents (Claude Code, Cursor, Codex and other MCP clients).

## Positioning

- Cloudflare-native end to end (Workers, D1, R2-ready, Turnstile, Email), not a Vercel template ported over.
- Agent-ready product out of the box: MCP server + OpenAPI + API keys.
- Nothing to delete: no demo widgets or fake business logic.

## Voice

Plain, specific, a little playful. Sentence case. Concrete nouns, commands and file paths over adjectives. No AI tells (see `.devin/skills/write-post` for the banned list).

## Surfaces

- `apps/site` (noomers.dev): Persuade. Sells the template.
- `apps/web` (app.noomers.dev): Operate. Dashboard, projects, settings, API keys, admin.
- `/blog/*`: Read. Long-form, answer-first.

## Platform

web

## Constraints

- App UI is built on Cloudflare Kumo; visual identity must be expressible as Kumo semantic token overrides (`packages/brand/tokens.css`, `light-dark()`, no `dark:` classes).
- Fonts must be open-licensed and available on @fontsource.
- WCAG AA contrast in light and dark.

## Open decisions

- Pricing, licensing tiers and sales channel are not decided. Do not show prices or license terms; use a neutral "Get noomers" call to action.
- No customers, testimonials or usage numbers exist yet. Do not invent them.
- Visual identity: Pixel crew with the Flare palette (see DESIGN.md).

Design system: see DESIGN.md. Design reviews: `impeccable` skill.
