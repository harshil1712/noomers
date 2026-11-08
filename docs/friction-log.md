# Friction log

See the friction-log skill for the entry format.

## 2026-10-30 — drizzle-kit generate broken under pinned versions

- What happened: `drizzle-kit generate` fails with `drizzle-orm/_relations` not
  exported under the baati-pinned drizzle-orm 0.45.4. Upgrading the app to
  drizzle-orm 1.0.0-rc.4 let `generate` emit SQL, but the worker bundle then
  broke at import time (`relations` API changed → `relations is not a
  function`), i.e. drizzle-orm 1.0.0-rc.4 is incompatible with better-auth's
  generated schema/drizzle adapter.
- Cost: ~30 min of version archaeology; starter still ships a hand-maintained
  `apps/web/migrations/0001_init.sql`.
- Suggested fix: when better-auth/drizzle-orm 1.0 stabilises (or drizzle-kit
  accepts 0.45.x), flip `db:generate` on and regenerate. Until then: edit
  0001_init.sql by hand, keep `auth:generate` for src/auth-schema.ts only.

## 2026-10-30 — drizzle-kit retry (rc.5): still broken, root cause confirmed

- What happened: tried drizzle-orm + drizzle-kit 1.0.0-rc.5. better-auth's
  `auth generate` emits only drizzle v0 `relations()` (no v1/defineRelations
  option in the CLI source). Stripping the relations blocks lets the code
  compile, but better-auth's drizzle adapter then reports "Drizzle schema
  mismatch — missing tables" at runtime: it introspects v0 table metadata and
  can't read orm-1.0 table objects. drizzle-orm 1.0 is incompatible with
  better-auth 1.7.12.
- Cost: ~25 min.
- Suggested fix: wait for better-auth to support drizzle-orm 1.0, then flip
  db:generate on. Until then migrations stay hand-maintained.
