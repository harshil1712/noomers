---
name: deploy
description: How this repo is deployed with Alchemy and Worker Previews — per-PR previews, production from main with smoke checks and automatic rollback. Use when changing infra, CI, or investigating a deploy.
---

# Deploy

All infrastructure lives in `alchemy.run.ts`. Stack `<name>`: workers `<name>-web` (app.<domain>, Vite SPA + Hono API + D1 + Better Auth) and `<name>-site` (<domain> apex, Astro static, www redirect), D1 `<name>-db`, prod-only Turnstile widget and Email sending subdomain. Names/domains come from `project.config.ts`.

## Previews (every PR)
- CI deploys a **Worker Preview** of each worker named `pr-<number>` (Alchemy `preview` prop), then smokes `pr-<n>--<name>-web.<sub>.workers.dev/api/health` and the site URL.
- Previews share production bindings unless isolated in config — never run destructive tests against them.
- When the PR closes, CI deletes its previews (`alchemy destroy --stage pr-<n>`).

## Production (merge to main only)
1. CI on `main`: install (frozen lockfile) → token preflight → `vp check` → tests → build → `alchemy deploy` for stage `prod`.
2. Before deploy, CI records each worker's live version. Post-deploy smoke: `GET /` on the site and `GET /api/health` on the app return 200.
3. Smoke fails → CI rolls back only the workers whose live version changed (`wrangler rollback`), then fails the run.

## Rules
- Never deploy production from a laptop or a branch. Never `alchemy destroy` the `prod` stage.
- New resources only via a reviewed PR to `alchemy.run.ts`.
- Secrets live in GitHub Actions secrets / Alchemy `Config.Redacted`; never in code. See `docs/deploy.md` for the token permissions and secrets list.
