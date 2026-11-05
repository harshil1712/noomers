import type { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vite-plus/test";

const sqlite = await import("node:sqlite").catch(() => null);
const describeWithSqlite = sqlite ? describe : describe.skip;

// Reads every *.sql file in ../migrations at transform time — works under the
// workerd test pool where readdirSync is unavailable.
const MIGRATION_SQL = import.meta.glob("../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const ALL_MIGRATIONS = Object.entries(MIGRATION_SQL)
  .filter(([path]) => /\/\d{4}_[^/]*\.sql$/.test(path))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

function apply(database: DatabaseSync): void {
  for (const sql of ALL_MIGRATIONS) {
    database.exec(sql);
  }
}

function columns(database: DatabaseSync, table: string): string[] {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return rows.map((row) => row.name);
}

describeWithSqlite("D1 migrations", () => {
  test("the full migration set applies to an empty database", () => {
    expect(ALL_MIGRATIONS.length).toBeGreaterThan(0);
    const database = new sqlite!.DatabaseSync(":memory:");
    apply(database);

    const tables = (
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "goals",
        "sites",
        "site_tombstones",
        "custom_properties",
        "site_deletion_jobs",
        "user",
        "session",
        "account",
        "verification",
      ]),
    );

    expect(columns(database, "sites")).toEqual(
      expect.arrayContaining([
        "domain",
        "tracker_id",
        "timezone",
        "tracker_script_configuration",
        "plausible_script_id",
      ]),
    );
    expect(columns(database, "site_deletion_jobs")).toEqual([
      "id",
      "site_id",
      "requested_at",
      "iceberg_status",
      "iceberg_updated_at",
      "iceberg_error",
      "attempt_count",
      "completed_at",
    ]);
  });

  test("site_deletion_jobs rejects completed_at while iceberg_status is pending", () => {
    const database = new sqlite!.DatabaseSync(":memory:");
    apply(database);

    expect(() =>
      database
        .prepare(
          `INSERT INTO site_deletion_jobs (id, site_id, requested_at, completed_at)
                     VALUES (?, ?, ?, ?)`,
        )
        .run("job-1", "a.com", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    ).toThrow(/CHECK/i);

    database
      .prepare(
        `INSERT INTO site_deletion_jobs
                    (id, site_id, requested_at, iceberg_status, completed_at)
                 VALUES (?, ?, ?, 'completed', ?)`,
      )
      .run("job-2", "b.com", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
  });

  test("site_deletion_jobs site_id is unique", () => {
    const database = new sqlite!.DatabaseSync(":memory:");
    apply(database);

    const insert = database.prepare(
      "INSERT INTO site_deletion_jobs (id, site_id, requested_at) VALUES (?, ?, ?)",
    );
    insert.run("job-1", "a.com", "2026-01-01T00:00:00.000Z");
    expect(() => insert.run("job-2", "a.com", "2026-01-02T00:00:00.000Z")).toThrow(/UNIQUE/i);
  });
});
