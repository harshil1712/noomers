import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";

const sqlite = await import("node:sqlite").catch(() => null);
const describeWithSqlite = sqlite ? describe : describe.skip;

const ALL_MIGRATIONS = [
    "0001_goals.sql",
    "0002_sites.sql",
    "0003_site_tombstones.sql",
    "0004_custom_properties.sql",
    "0005_site_deletion_jobs.sql",
    "0006_deletion_job_expanded.sql",
];

function migrationSql(name: string): string {
    return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

function apply(database: DatabaseSync, files: string[]): void {
    for (const file of files) {
        database.exec(migrationSql(file));
    }
}

function columns(database: DatabaseSync, table: string): string[] {
    const rows = database
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{
        name: string;
    }>;
    return rows.map((row) => row.name);
}

function tableSql(database: DatabaseSync, table: string): string {
    const row = database
        .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table) as { sql: string } | undefined;
    return row?.sql ?? "";
}

describeWithSqlite("0006 deletion job expanded schema", () => {
    test("fresh install produces the DEL-005 schema", () => {
        const database = new sqlite!.DatabaseSync(":memory:");
        apply(database, ALL_MIGRATIONS);

        const table = columns(database, "site_deletion_jobs");
        expect(table).toEqual(
            expect.arrayContaining([
                "id",
                "site_id",
                "requested_at",
                "analytics_engine_status",
                "analytics_engine_expires_at",
                "iceberg_status",
                "iceberg_updated_at",
                "iceberg_error",
                "daily_rollup_status",
                "daily_rollup_updated_at",
                "daily_rollup_error",
                "attempt_count",
                "next_attempt_at",
                "last_error",
                "lease_token",
                "lease_owner",
                "lease_expires_at",
                "lease_acquired_at",
                "completed_at",
            ]),
        );

        const sql = tableSql(database, "site_deletion_jobs");
        // Iceberg exposes an explicit 'blocked' state.
        expect(sql).toContain("'blocked'");
        // Terminal completion is constrained to all three layers being done.
        expect(sql).toContain("daily_rollup_status = 'completed'");
        expect(sql).toContain("iceberg_status = 'completed'");
        expect(sql).toContain("analytics_engine_status = 'expired'");
        // Lease token is a unique claim handle.
        expect(sql).toContain("lease_token TEXT UNIQUE");

        // A job inserted with the expanded columns is claimable immediately.
        database
            .prepare(
                `INSERT INTO site_deletion_jobs
                    (id, site_id, requested_at, analytics_engine_expires_at, next_attempt_at)
                 VALUES (?, ?, ?, ?, ?)`,
            )
            .run(
                "job-1",
                "a.com",
                "2026-01-01T00:00:00.000Z",
                "2026-04-01T00:00:00.000Z",
                "2026-01-01T00:00:00.000Z",
            );
        const due = database
            .prepare(
                `SELECT id FROM site_deletion_jobs
                 WHERE completed_at IS NULL AND next_attempt_at <= '2026-01-02T00:00:00.000Z'`,
            )
            .get() as { id: string };
        expect(due.id).toBe("job-1");
    });

    test("upgrade from 0005 backfills existing rows due immediately", () => {
        const database = new sqlite!.DatabaseSync(":memory:");
        apply(database, ALL_MIGRATIONS.slice(0, 5));

        const insertOld = database.prepare(
            `INSERT INTO site_deletion_jobs
                (id, site_id, requested_at, analytics_engine_status,
                 analytics_engine_expires_at, iceberg_status, iceberg_updated_at, iceberg_error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        insertOld.run(
            "old-1",
            "a.com",
            "2026-01-01T00:00:00.000Z",
            "pending_expiry",
            "2026-04-01T00:00:00.000Z",
            "pending",
            null,
            null,
        );
        insertOld.run(
            "old-2",
            "b.com",
            "2026-01-02T00:00:00.000Z",
            "expired",
            "2026-01-01T00:00:00.000Z",
            "completed",
            "2026-01-03T00:00:00.000Z",
            null,
        );

        apply(database, ["0006_deletion_job_expanded.sql"]);

        const all = database
            .prepare("SELECT * FROM site_deletion_jobs ORDER BY requested_at")
            .all() as Array<Record<string, unknown>>;
        expect(all).toHaveLength(2);

        for (const row of all) {
            expect(row.attempt_count).toBe(0);
            expect(row.daily_rollup_status).toBe("pending");
            expect(row.daily_rollup_updated_at).toBeNull();
            expect(row.daily_rollup_error).toBeNull();
            expect(row.lease_token).toBeNull();
            expect(row.lease_owner).toBeNull();
            expect(row.lease_expires_at).toBeNull();
            expect(row.lease_acquired_at).toBeNull();
            expect(row.completed_at).toBeNull();
            expect(row.last_error).toBeNull();
            // Backfilled rows are due immediately: next_attempt_at mirrors the
            // original (past) request time.
            expect(row.next_attempt_at).toBe(row.requested_at);
        }

        const b = all.find((row) => row.id === "old-2") as Record<
            string,
            unknown
        >;
        expect(b.iceberg_status).toBe("completed");
        expect(b.iceberg_updated_at).toBe("2026-01-03T00:00:00.000Z");
        expect(b.analytics_engine_status).toBe("expired");

        // The 0005 table and its auto-renamed index are gone; only the rebuilt
        // table and the two indexes remain.
        const objects = database
            .prepare(
                "SELECT name FROM sqlite_master WHERE name LIKE '%site_deletion_jobs%' AND sql IS NOT NULL ORDER BY name",
            )
            .all() as Array<{ name: string }>;
        expect(objects.map((row) => row.name)).toEqual([
            "site_deletion_jobs",
            "site_deletion_jobs_due_idx",
            "site_deletion_jobs_iceberg_status_idx",
        ]);

        // Backfilled jobs are claimable immediately.
        const due = database
            .prepare(
                `SELECT count(*) AS c FROM site_deletion_jobs
                 WHERE completed_at IS NULL AND next_attempt_at <= '2026-01-05T00:00:00.000Z'`,
            )
            .get() as { c: number };
        expect(Number(due.c)).toBe(2);
    });
});
