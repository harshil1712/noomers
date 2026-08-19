import { readFileSync } from "node:fs";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DeletionJobsRepository } from "../repository";

const sqlite = await import("node:sqlite").catch(() => null);
const describeWithSqlite = sqlite ? describe : describe.skip;

// ---------------------------------------------------------------------------
// D1 shim over node:sqlite so repository behavior can be exercised against the
// real DEL-005 schema produced by the migrations.
// ---------------------------------------------------------------------------

type SqliteParam = null | number | bigint | string | Uint8Array;

class SqlitePreparedStatement {
    private args: SqliteParam[] = [];

    constructor(private readonly statement: StatementSync) {}

    bind(...values: SqliteParam[]) {
        this.args = values;
        return this;
    }

    async all<T>() {
        const rows = this.statement.all(...this.args) as Record<
            string,
            unknown
        >[];
        return {
            results: rows.map((row) => ({ ...row })) as T[],
            success: true,
            meta: { changes: 0, duration: 0 },
        };
    }

    async first<T>() {
        const rows = this.statement.all(...this.args) as Record<
            string,
            unknown
        >[];
        return Promise.resolve(rows[0] ? ({ ...rows[0] } as T) : null);
    }

    async run<T>() {
        const result = this.statement.run(...this.args);
        return {
            results: [] as T[],
            success: true,
            meta: { changes: Number(result.changes), duration: 0 },
        };
    }
}

class SqliteDatabase {
    constructor(private readonly database: DatabaseSync) {}

    prepare(sql: string) {
        return new SqlitePreparedStatement(this.database.prepare(sql));
    }

    async exec(sql: string) {
        this.database.exec(sql);
        return { count: 0, duration: 0 };
    }

    async batch<T>(statements: SqlitePreparedStatement[]) {
        this.database.exec("BEGIN");
        try {
            const results = [];
            for (const statement of statements) {
                results.push(await statement.all<T>());
            }
            this.database.exec("COMMIT");
            return results;
        } catch (error) {
            this.database.exec("ROLLBACK");
            throw error;
        }
    }
}

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:01:00.000Z";

interface JobSeed {
    id: string;
    siteId?: string;
    requestedAt?: string;
    analyticsEngineExpiresAt?: string;
    analyticsEngineStatus?: string;
    icebergStatus?: string;
    icebergUpdatedAt?: string | null;
    icebergError?: string | null;
    dailyRollupStatus?: string;
    dailyRollupUpdatedAt?: string | null;
    dailyRollupError?: string | null;
    attemptCount?: number;
    nextAttemptAt?: string;
    lastError?: string | null;
    leaseToken?: string | null;
    leaseOwner?: string | null;
    leaseExpiresAt?: string | null;
    leaseAcquiredAt?: string | null;
    completedAt?: string | null;
}

const JOB_COLUMNS = `(
    id,
    site_id,
    requested_at,
    analytics_engine_status,
    analytics_engine_expires_at,
    iceberg_status,
    iceberg_updated_at,
    iceberg_error,
    daily_rollup_status,
    daily_rollup_updated_at,
    daily_rollup_error,
    attempt_count,
    next_attempt_at,
    last_error,
    lease_token,
    lease_owner,
    lease_expires_at,
    lease_acquired_at,
    completed_at
)`;

describe("DeletionJobsRepository (mocked D1)", () => {
    const first = vi.fn();
    const all = vi.fn();
    const bind = vi.fn(() => ({ first, all }));
    const prepare = vi.fn((_sql: string) => ({ bind }));
    const repository = new DeletionJobsRepository({
        prepare,
    } as unknown as D1Database);

    beforeEach(() => {
        vi.clearAllMocks();
        first.mockResolvedValue(null);
        all.mockResolvedValue({ results: [] });
    });

    test("rejects unbounded or invalid claim batches before touching D1", async () => {
        await expect(
            repository.claim({
                batchSize: 0,
                now: NOW,
                leaseDurationMs: 60_000,
                owner: "worker-1",
            }),
        ).rejects.toThrow("batchSize");
        await expect(
            repository.claim({
                batchSize: 101,
                now: NOW,
                leaseDurationMs: 60_000,
                owner: "worker-1",
            }),
        ).rejects.toThrow("batchSize");
        await expect(
            repository.claim({
                batchSize: 1.5,
                now: NOW,
                leaseDurationMs: 60_000,
                owner: "worker-1",
            }),
        ).rejects.toThrow("batchSize");
        await expect(
            repository.claim({
                batchSize: 1,
                now: "not-a-date",
                leaseDurationMs: 60_000,
                owner: "worker-1",
            }),
        ).rejects.toThrow("now");
        await expect(
            repository.claim({
                batchSize: 1,
                now: NOW,
                leaseDurationMs: 0,
                owner: "worker-1",
            }),
        ).rejects.toThrow("leaseDurationMs");
        await expect(
            repository.claim({
                batchSize: 1,
                now: NOW,
                leaseDurationMs: 60_000,
                owner: "",
            }),
        ).rejects.toThrow("owner");
        expect(prepare).not.toHaveBeenCalled();
    });

    test("claims due jobs via a single conditional UPDATE ... RETURNING with a unique lease token", async () => {
        all.mockResolvedValue({
            results: [
                {
                    id: "job-1",
                    site_id: "a.com",
                    requested_at: NOW,
                    analytics_engine_status: "pending_expiry",
                    analytics_engine_expires_at: "2026-04-01T00:00:00.000Z",
                    iceberg_status: "pending",
                    iceberg_updated_at: null,
                    iceberg_error: null,
                    daily_rollup_status: "pending",
                    daily_rollup_updated_at: null,
                    daily_rollup_error: null,
                    attempt_count: 1,
                    next_attempt_at: NOW,
                    last_error: null,
                    lease_token: "lease-1:job-1",
                    lease_owner: "worker-1",
                    lease_expires_at: LATER,
                    lease_acquired_at: NOW,
                    completed_at: null,
                },
            ],
        });

        const jobs = await repository.claim({
            batchSize: 10,
            now: NOW,
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "lease-1",
        });

        expect(jobs).toHaveLength(1);
        expect(jobs[0]).toMatchObject({
            id: "job-1",
            siteId: "a.com",
            attemptCount: 1,
            leaseToken: "lease-1:job-1",
            leaseOwner: "worker-1",
            leaseExpiresAt: LATER,
        });
        const sql = prepare.mock.calls[0][0] as string;
        expect(sql).toContain("UPDATE site_deletion_jobs");
        expect(sql).toContain("RETURNING");
        expect(sql).toContain("attempt_count = attempt_count + 1");
        expect(sql).toContain("completed_at IS NULL");
        expect(sql).toContain("next_attempt_at");
        expect(sql).toContain("lease_token IS NULL OR lease_expires_at");
        expect(sql).toContain("LIMIT");
        expect(bind).toHaveBeenCalledWith(
            "lease-1",
            "worker-1",
            NOW,
            LATER,
            10,
        );
    });

    test("lease-guarded updates are rejected when the token is no longer valid", async () => {
        first.mockResolvedValue(null);
        await expect(
            repository.completeDailyRollup({
                jobId: "job-1",
                leaseToken: "expired-token",
                at: LATER,
            }),
        ).resolves.toBeNull();
        expect(bind).toHaveBeenCalledWith(LATER, "job-1", "expired-token");
    });

    test("rejects malformed guarded inputs before touching D1", async () => {
        await expect(
            repository.failIceberg({
                jobId: "job-1",
                leaseToken: "token",
                at: NOW,
                nextAttemptAt: "2026-01-02T00:00:00.000Z",
                error: "",
            }),
        ).rejects.toThrow("error");
        await expect(
            repository.complete({
                jobId: "job-1",
                leaseToken: "token",
                at: "bad",
            }),
        ).rejects.toThrow("at");
        await expect(
            repository.release({
                jobId: "",
                leaseToken: "token",
                nextAttemptAt: "2026-01-02T00:00:00.000Z",
            }),
        ).rejects.toThrow("jobId");
        expect(prepare).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Integration tests against the real DEL-005 schema (migrations 0005 + 0006)
// executed on node:sqlite.
// ---------------------------------------------------------------------------

describeWithSqlite("DeletionJobsRepository (node:sqlite integration)", () => {
    let database: DatabaseSync;
    let repository: DeletionJobsRepository;

    function seed(row: JobSeed) {
        database
            .prepare(
                `INSERT INTO site_deletion_jobs ${JOB_COLUMNS}
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                row.id,
                row.siteId ?? row.id,
                row.requestedAt ?? NOW,
                row.analyticsEngineStatus ?? "pending_expiry",
                row.analyticsEngineExpiresAt ?? "2026-04-01T00:00:00.000Z",
                row.icebergStatus ?? "pending",
                row.icebergUpdatedAt ?? null,
                row.icebergError ?? null,
                row.dailyRollupStatus ?? "pending",
                row.dailyRollupUpdatedAt ?? null,
                row.dailyRollupError ?? null,
                row.attemptCount ?? 0,
                row.nextAttemptAt ?? NOW,
                row.lastError ?? null,
                row.leaseToken ?? null,
                row.leaseOwner ?? null,
                row.leaseExpiresAt ?? null,
                row.leaseAcquiredAt ?? null,
                row.completedAt ?? null,
            );
    }

    function rows(sql: string, ...params: SqliteParam[]) {
        return database.prepare(sql).all(...params) as Record<
            string,
            unknown
        >[];
    }

    beforeEach(() => {
        database = new sqlite!.DatabaseSync(":memory:");
        for (const file of [
            "0005_site_deletion_jobs.sql",
            "0006_deletion_job_expanded.sql",
        ]) {
            database.exec(
                readFileSync(
                    new URL(`../../../migrations/${file}`, import.meta.url),
                    "utf8",
                ),
            );
        }
        repository = new DeletionJobsRepository(
            new SqliteDatabase(database) as unknown as D1Database,
        );
    });

    test("claims only due, unleased jobs in due order with attempt accounting", async () => {
        seed({ id: "job-1", nextAttemptAt: "2026-01-05T00:00:00.000Z" });
        seed({ id: "job-2", nextAttemptAt: "2026-01-02T00:00:00.000Z" });
        seed({ id: "job-3", nextAttemptAt: "2026-01-02T00:00:00.000Z" });

        const jobs = await repository.claim({
            batchSize: 2,
            now: "2026-01-06T00:00:00.000Z",
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "c1",
        });

        expect(jobs.map((job) => job.id)).toEqual(["job-2", "job-3"]);
        for (const job of jobs) {
            expect(job.attemptCount).toBe(1);
            expect(job.leaseOwner).toBe("worker-1");
            expect(job.leaseExpiresAt).toBe("2026-01-06T00:01:00.000Z");
            expect(job.leaseToken).toBe(`c1:${job.id}`);
            expect(job.completedAt).toBeNull();
        }
        expect(
            rows(
                "SELECT lease_token FROM site_deletion_jobs WHERE id = 'job-1'",
            ),
        ).toEqual([{ lease_token: null }]);
    });

    test("a later claim with a fresh token never double-claims rows held by a live lease", async () => {
        seed({ id: "job-1", nextAttemptAt: NOW });
        seed({ id: "job-2", nextAttemptAt: NOW });

        const first = await repository.claim({
            batchSize: 10,
            now: NOW,
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "w1",
        });
        const second = await repository.claim({
            batchSize: 10,
            now: NOW,
            leaseDurationMs: 60_000,
            owner: "worker-2",
            leaseTokenPrefix: "w2",
        });

        expect(first.map((job) => job.id)).toEqual(["job-1", "job-2"]);
        expect(second).toHaveLength(0);
        const leased = rows(
            "SELECT id, lease_owner, attempt_count FROM site_deletion_jobs ORDER BY id",
        );
        expect(leased).toEqual([
            { id: "job-1", lease_owner: "worker-1", attempt_count: 1 },
            { id: "job-2", lease_owner: "worker-1", attempt_count: 1 },
        ]);
    });

    test("reclaims stale leases and increments the attempt count again", async () => {
        seed({
            id: "job-1",
            nextAttemptAt: NOW,
            attemptCount: 1,
            leaseToken: "dead:job-1",
            leaseOwner: "dead-worker",
            leaseExpiresAt: NOW,
        });
        seed({
            id: "job-2",
            nextAttemptAt: NOW,
            leaseToken: "live:job-2",
            leaseOwner: "live-worker",
            leaseExpiresAt: LATER,
        });

        const jobs = await repository.claim({
            batchSize: 10,
            now: NOW,
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "new",
        });

        expect(jobs.map((job) => job.id)).toEqual(["job-1"]);
        expect(jobs[0].attemptCount).toBe(2);
        expect(jobs[0].leaseToken).toBe("new:job-1");
        expect(jobs[0].leaseOwner).toBe("worker-1");
    });

    test("excludes completed jobs from claims", async () => {
        seed({
            id: "done",
            nextAttemptAt: NOW,
            completedAt: "2025-12-31T00:00:00.000Z",
            dailyRollupStatus: "completed",
            icebergStatus: "completed",
            analyticsEngineStatus: "expired",
        });
        seed({ id: "todo", nextAttemptAt: NOW });

        const jobs = await repository.claim({
            batchSize: 10,
            now: NOW,
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "t",
        });

        expect(jobs.map((job) => job.id)).toEqual(["todo"]);
    });

    test("completeDailyRollup is lease-token guarded and idempotent-safe", async () => {
        seed({ id: "job-1", nextAttemptAt: NOW });
        const [job] = await repository.claim({
            batchSize: 1,
            now: NOW,
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "t",
        });

        const updated = await repository.completeDailyRollup({
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            at: "2026-01-01T00:05:00.000Z",
        });
        expect(updated?.dailyRollupStatus).toBe("completed");
        expect(updated?.dailyRollupUpdatedAt).toBe("2026-01-01T00:05:00.000Z");

        const stale = await repository.completeDailyRollup({
            jobId: job.id,
            leaseToken: "wrong-token",
            at: "2026-01-01T00:06:00.000Z",
        });
        expect(stale).toBeNull();
        const persisted = rows(
            "SELECT daily_rollup_status, daily_rollup_updated_at FROM site_deletion_jobs WHERE id = ?",
            job.id,
        );
        expect(persisted[0]).toEqual({
            daily_rollup_status: "completed",
            daily_rollup_updated_at: "2026-01-01T00:05:00.000Z",
        });
    });

    test("failDailyRollup records the error, schedules backoff, and releases the lease", async () => {
        seed({ id: "job-1", nextAttemptAt: NOW });
        const [job] = await repository.claim({
            batchSize: 1,
            now: NOW,
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "t",
        });

        const updated = await repository.failDailyRollup({
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            at: "2026-01-01T00:05:00.000Z",
            nextAttemptAt: "2026-01-01T01:00:00.000Z",
            error: "rollup deletion failed",
        });

        expect(updated).toMatchObject({
            dailyRollupStatus: "failed",
            dailyRollupError: "rollup deletion failed",
            lastError: "rollup deletion failed",
            nextAttemptAt: "2026-01-01T01:00:00.000Z",
            leaseToken: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            leaseAcquiredAt: null,
        });

        const requeued = await repository.claim({
            batchSize: 10,
            now: "2026-01-01T00:06:00.000Z",
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "t2",
        });
        expect(requeued).toHaveLength(0);
    });

    test("blockIceberg records an explicit blocked state", async () => {
        seed({ id: "job-1", nextAttemptAt: NOW });
        const [job] = await repository.claim({
            batchSize: 1,
            now: NOW,
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "t",
        });

        const updated = await repository.blockIceberg({
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            at: "2026-01-01T00:05:00.000Z",
            nextAttemptAt: "2026-01-02T00:00:00.000Z",
            error: "no writable Iceberg engine",
        });

        expect(updated).toMatchObject({
            icebergStatus: "blocked",
            icebergError: "no writable Iceberg engine",
            lastError: "no writable Iceberg engine",
            nextAttemptAt: "2026-01-02T00:00:00.000Z",
            leaseToken: null,
        });
    });

    test("expireAnalyticsEngine only succeeds once the expiry time has passed", async () => {
        seed({
            id: "job-1",
            nextAttemptAt: NOW,
            analyticsEngineExpiresAt: "2026-04-01T00:00:00.000Z",
        });
        const [job] = await repository.claim({
            batchSize: 1,
            now: NOW,
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "t",
        });

        const early = await repository.expireAnalyticsEngine({
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            at: "2026-03-01T00:00:00.000Z",
        });
        expect(early).toBeNull();

        const onTime = await repository.expireAnalyticsEngine({
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            at: "2026-04-01T00:00:00.000Z",
        });
        expect(onTime?.analyticsEngineStatus).toBe("expired");
        expect(onTime?.leaseToken).toBe(job.leaseToken);
    });

    test("terminal completion requires daily rollup, Iceberg, and Analytics Engine to all be terminal", async () => {
        seed({
            id: "job-1",
            nextAttemptAt: NOW,
            analyticsEngineExpiresAt: NOW,
        });
        const [job] = await repository.claim({
            batchSize: 1,
            now: NOW,
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "t",
        });

        const premature = await repository.complete({
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            at: "2026-01-01T00:10:00.000Z",
        });
        expect(premature).toBeNull();

        await repository.completeDailyRollup({
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            at: "2026-01-01T00:05:00.000Z",
        });
        await repository.completeIceberg({
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            at: "2026-01-01T00:06:00.000Z",
        });
        await repository.expireAnalyticsEngine({
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            at: NOW,
        });

        const completed = await repository.complete({
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            at: "2026-01-01T00:10:00.000Z",
        });
        expect(completed?.completedAt).toBe("2026-01-01T00:10:00.000Z");
        expect(completed?.leaseToken).toBeNull();
        expect(completed?.attemptCount).toBe(1);

        // A completed job is never claimed again.
        const again = await repository.claim({
            batchSize: 10,
            now: "2026-01-02T00:00:00.000Z",
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "t2",
        });
        expect(again).toHaveLength(0);
    });

    test("release requeues the job and clears the lease", async () => {
        seed({ id: "job-1", nextAttemptAt: NOW });
        const [job] = await repository.claim({
            batchSize: 1,
            now: NOW,
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "t",
        });

        const released = await repository.release({
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            nextAttemptAt: "2026-01-02T00:00:00.000Z",
            error: "rescheduled",
        });
        expect(released).toMatchObject({
            nextAttemptAt: "2026-01-02T00:00:00.000Z",
            lastError: "rescheduled",
            leaseToken: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            leaseAcquiredAt: null,
        });
    });

    test("routine release preserves the last recorded error", async () => {
        seed({ id: "job-1", nextAttemptAt: NOW, lastError: "blocked" });
        const [job] = await repository.claim({
            batchSize: 1,
            now: NOW,
            leaseDurationMs: 60_000,
            owner: "worker-1",
            leaseTokenPrefix: "t",
        });

        const released = await repository.release({
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            nextAttemptAt: "2026-01-02T00:00:00.000Z",
        });

        expect(released?.lastError).toBe("blocked");
    });

    test("reads jobs by id and site id", async () => {
        seed({ id: "job-1", siteId: "a.com" });
        expect((await repository.get("job-1"))?.siteId).toBe("a.com");
        expect((await repository.getBySiteId("a.com"))?.id).toBe("job-1");
        expect(await repository.get("missing")).toBeNull();
        expect(await repository.getBySiteId("missing.com")).toBeNull();
    });
});
