---
title: "What the noomers starter actually gives you"
description: "A walk through the auth, database, admin area and deploy pipeline that come with this Cloudflare starter, and the parts you still own."
pubDate: 2026-10-30
updatedDate: 2026-10-30
author: "noomers team"
tags: ["starter", "cloudflare"]
tldr: "noomers is a monorepo where sign-in, a D1 database, an admin area and a deploy pipeline already work; you rename it and write your product instead of its plumbing. This post lists exactly what is wired and what is left to you."
faq:
  - q: "Does the starter include user accounts?"
    a: "Yes. Email/password sign-up with verification, Google sign-in when you add OAuth keys, session management and an admin area (ban, role change, session revocation) all work out of the box."
  - q: "What do I need to deploy it?"
    a: "A Cloudflare account, a domain, and the GitHub secrets listed in docs/deploy.md. Production ships through a merged PR. The workflow runs checks, deploys, smoke-tests and rolls back on failure."
---

## The short version

noomers is a pnpm monorepo: a React single-page app (`apps/web`), a static marketing site (`apps/site`), a shared brand package, and one `alchemy.run.ts` that describes all the Cloudflare infrastructure. Copy it, run the init script with your name and domain, and you have a working product skeleton.

## What is already wired

**Auth.** Better Auth handles email/password with mandatory verification, password reset, Google sign-in, and an admin plugin. Turnstile sits on the credential endpoints. Setting `OWNER_ADMIN_EMAIL` promotes your verified account to admin automatically.

**Database.** D1 with Drizzle ORM. The auth schema is generated (`npm run auth:generate`) and migrations live in `apps/web/migrations`.

**Admin area.** An admin-only page lists users and supports role changes, bans and session revocation through the Better Auth admin plugin.

**Deploys.** Push to `main` runs check → test → build → deploy → smoke → automatic rollback. Every PR gets a preview deployment. The whole config is one file, and nothing lives outside it.

## What is left to you

The product itself: schema tables, routes, screens. The starter deliberately ships no demo widgets or sample business logic, so there is nothing to delete before you start.
