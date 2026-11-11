# Migrations

Hand-maintained SQL, applied by Alchemy on deploy (see `alchemy.run.ts`).

- `0001_init.sql` — the baseline schema: goals, sites, site tombstones,
  custom properties, and site deletion jobs.
- `0002_auth.sql` — Better Auth schema (user/session/account/verification),
  matching `src/auth-schema.ts` (regenerate that file with
  `vp run auth:generate`).
- `0003_goal_currency.sql` — goal currency column.
- `0004_drop_site_deletion_jobs.sql` — drops the deletion-jobs table; Iceberg
  erasure is now a manual command, not a worker-tracked job.
- `0005_drop_plausible_script_id.sql` — drops the Plausible-compat script id
  column and its index; noomers serves only `tracker.js`.

Migrations are append-only: add the next numbered file and never edit or
rename one that any deployment has applied. Nothing has been deployed yet,
so 0001/0002 are still the unapplied baseline — once a deployment exists,
treat them as frozen like every later migration.

`drizzle-kit generate` is broken under the pinned drizzle-orm 0.45.4 (see
docs/friction-log.md), so auth schema changes are hand-kept in sync.
