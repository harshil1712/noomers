---
name: add-resource
description: Add a new owned resource end to end — Drizzle schema and migration, zod/OpenAPI schemas, service, scopes, session + /api/v1 routes, MCP tools, UI, tests. Use Projects as the worked reference.
---

# Add a resource end to end

One service layer backs three surfaces (session `/api/<name>`, key-gated `/api/v1`, MCP at `/mcp`) — add each layer in this order so nothing drifts. Projects (`prj_…`) is the reference implementation; mirror its files.

## Steps, in order

1. **Schema** — `apps/web/schema/<name>.ts`: `sqliteTable` with `<prefix>_`-prefixed `nanoid(16)` id, `owner_id` FK → `user.id` cascade, timestamp_ms `$defaultFn`s, index on `(owner_id, updated_at DESC, id)`. Re-export from `schema/db.ts`.
2. **Migration** — hand-write `apps/web/migrations/000N_<name>.sql` to match exactly (drizzle-kit generate is broken — see `migrations/README.md`). Tests apply real migrations via `applyD1Migrations`, so a mismatch fails there.
3. **Zod schemas** — `worker/api/schemas.ts`: `…Create` (trimmed bounds), `…Update` (field object + `.refine` non-empty — export the unrefined `…PatchFields` too, MCP reuses it), `…ListQuery`, `…Result`. Every component needs `.openapi()` name + example — the v1 test asserts it.
4. **Service** — `worker/services/<name>.ts`: pure Drizzle, owner-scoped (not-yours = `not_found`), `ServiceError` (`not_found` | `validation_failed`), keyset pagination (`updatedAt,id DESC`, `limit+1`, base64url `${ms}:${id}` cursor).
5. **Scopes** — extend `Scope` + `KNOWN_SCOPES` (worker/middleware/principal.ts), `Scope` + `ApiKeyCreate` (schemas.ts), the `resource` parameter type of `requireScope`/`hasScope`, the write⇒read mapping in `worker/api/api-keys.ts`, and the Settings checkbox list (`api-keys-section.tsx`). Write implies read.
6. **Router** — `worker/api/<name>.ts`: one `OpenAPIHono` router, `createRoute` with relative paths, per-route `requireScope`, `validationHook` + `onApiError`, **no auth inside**. Mount: `app.use("/api/<name>", sessionPrincipal)` + `app.use("/api/<name>/*", sessionPrincipal)` + `app.route("/api", …)` in index.ts, and `.route("/", <name>Api)` inside `createV1Api` — its definitions merge into the OpenAPI doc automatically.
7. **MCP tools** — `worker/mcp.ts`: one `registerTool` per operation (title, agent-written description, input/output schemas, annotations) — wrap the handler in `guarded(principal, "<tool>", "read|write", fn)`; it does scope check → ServiceError/logged-internal envelopes.
8. **UI** — `src/routes/_authed/<name>.tsx` + nav item: `kumo-ui` (Kumo components only, Phosphor icons, no `dark:` classes), loader + `router.invalidate()`, fetch helpers that throw the envelope message.
9. **Tests** — mirror `tests/projects.test.ts` (CRUD, envelopes, cursor, cross-user 404, cascade), extend `tests/v1.test.ts` (operation count + paths in the openapi.json assertions) and `tests/mcp.test.ts` (tool count, annotations).

## Gotchas (we hit these)

- **Middleware bleed**: `.use("*")` inside a sub-app merged at `/api` runs on ALL of `/api/*`. Use mount-level `app.use("/api/<x>", sessionPrincipal)`, or `basePath("/api/v1")` like the v1 factory.
- **Rate limit in tests**: the test `API_RATE_LIMITER` is 20 keyed requests/min — create a fresh API key per test so you never hit it.
- **`/api-key/list` `permissions` comes back already parsed** (object, not JSON string) — don't `JSON.parse` it.
- **Verify**: `vp check` → `vp run -r test` → `vp run -r build`; UI work also needs `verify-ui` screenshots. Ship via `ship-pr`.
