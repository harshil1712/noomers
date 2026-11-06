# Migrations

Hand-maintained SQL, applied by Alchemy on deploy (see `alchemy.run.ts`).

- `0001_goals.sql` … `0007_plausible_script_id.sql` — noomers' original D1
  schema. **Byte-identical to the migrations the existing production database
  applied under these filenames** (wrangler → Alchemy adopts the history).
  Never edit them.
- `0008_auth.sql` — Better Auth schema (user/session/account/verification),
  matching `src/auth-schema.ts` (regenerate that file with
  `vp run auth:generate`).
- `__tests__/` — migration-specific tests.

`drizzle-kit generate` is broken under the pinned drizzle-orm 0.45.4 (see
docs/friction-log.md), so auth schema changes are hand-kept in sync.
