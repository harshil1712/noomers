import { beforeEach, describe, expect, test, vi } from "vitest";

import {
    DEFAULT_MAX_JOBS_PER_RUN,
    DELETION_LEASE_DURATION_MS,
    DELETION_LEASE_OWNER,
    ICEBERG_BLOCKED_MESSAGE,
    MAX_JOBS_PER_RUN_LIMIT,
    nextRetryDate,
    rescheduleAt,
    runDeletionJobs,
} from "../deletion";

const NOW = new Date("2024-01-18T02:00:00.000Z");

function createJob(overrides: Record<string, unknown> = {}) {
    const id = (overrides.id as string) ?? "job-1";
    return {
        id,
        siteId: "example.com",
        requestedAt: "2024-01-01T00:00:00.000Z",
        analyticsEngineStatus: "pending_expiry",
        analyticsEngineExpiresAt: "2024-04-01T00:00:00.000Z",
        icebergStatus: "pending",
        icebergUpdatedAt: null,
        icebergError: null,
        dailyRollupStatus: "pending",
        dailyRollupUpdatedAt: null,
        dailyRollupError: null,
        attemptCount: 1,
        nextAttemptAt: NOW.toISOString(),
        lastError: null,
        leaseToken: `lease:${id}`,
        leaseOwner: DELETION_LEASE_OWNER,
        leaseExpiresAt: "2024-01-18T02:10:00.000Z",
        leaseAcquiredAt: NOW.toISOString(),
        completedAt: null,
        ...overrides,
    };
}

function createRepository(jobs: unknown[] = []) {
    return {
        claim: vi.fn().mockResolvedValue(jobs),
        blockIceberg: vi.fn().mockResolvedValue({ id: "job" }),
        release: vi.fn().mockResolvedValue({ id: "job" }),
    };
}

type Repository = ReturnType<typeof createRepository>;

describe("runDeletionJobs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("claims a bounded batch of due jobs exactly once per run", async () => {
        const repository = createRepository([
            createJob(),
            createJob({ id: "job-2" }),
        ]);

        const result = await runDeletionJobs(repository as never, { now: NOW });

        expect(repository.claim).toHaveBeenCalledTimes(1);
        expect(repository.claim).toHaveBeenCalledWith({
            batchSize: DEFAULT_MAX_JOBS_PER_RUN,
            now: NOW.toISOString(),
            leaseDurationMs: DELETION_LEASE_DURATION_MS,
            owner: DELETION_LEASE_OWNER,
        });
        expect(result.claimed).toBe(2);
        expect(result.markedIcebergBlocked).toBe(2);
        expect(result.rescheduled).toBe(2);
        expect(result.transientFailures).toBe(0);
        expect(result.lostLeases).toBe(0);
        expect(repository.release).not.toHaveBeenCalled();
    });

    test("blocks pending Iceberg through the lease-guarded mutation", async () => {
        const repository = createRepository([createJob()]);

        await runDeletionJobs(repository as never, { now: NOW });

        expect(repository.blockIceberg).toHaveBeenCalledTimes(1);
        expect(repository.blockIceberg).toHaveBeenCalledWith({
            jobId: "job-1",
            leaseToken: "lease:job-1",
            at: NOW.toISOString(),
            error: ICEBERG_BLOCKED_MESSAGE,
            nextAttemptAt: "2024-01-19T02:00:00.000Z",
        });
    });

    test("releases already blocked, completed, or failed jobs without re-marking", async () => {
        const repository = createRepository([
            createJob({ id: "job-blocked", icebergStatus: "blocked" }),
            createJob({ id: "job-completed", icebergStatus: "completed" }),
            createJob({
                id: "job-failed",
                icebergStatus: "failed",
                icebergError: ICEBERG_BLOCKED_MESSAGE,
            }),
        ]);

        const result = await runDeletionJobs(repository as never, { now: NOW });

        expect(repository.blockIceberg).not.toHaveBeenCalled();
        expect(repository.release).toHaveBeenCalledTimes(3);
        expect(repository.release).toHaveBeenCalledWith({
            jobId: "job-blocked",
            leaseToken: "lease:job-blocked",
            nextAttemptAt: "2024-01-19T02:00:00.000Z",
        });
        expect(result.rescheduled).toBe(3);
        expect(result.markedIcebergBlocked).toBe(0);
    });

    test("leaves daily-rollup and Analytics Engine expiry pending", async () => {
        const repository = createRepository([createJob()]);

        await runDeletionJobs(repository as never, { now: NOW });

        expect(repository.blockIceberg).toHaveBeenCalledTimes(1);
        expect(repository.release).not.toHaveBeenCalled();
    });

    test("reschedules unfinished phases no later than 24 hours", async () => {
        const repository = createRepository([createJob()]);

        await runDeletionJobs(repository as never, { now: NOW });

        expect(repository.blockIceberg).toHaveBeenCalledWith(
            expect.objectContaining({
                nextAttemptAt: "2024-01-19T02:00:00.000Z",
            }),
        );
    });

    test("uses the earlier Analytics Engine expiry when it is sooner than 24 hours", async () => {
        const repository = createRepository([
            createJob({ analyticsEngineExpiresAt: "2024-01-18T12:00:00.000Z" }),
        ]);

        await runDeletionJobs(repository as never, { now: NOW });

        expect(repository.blockIceberg).toHaveBeenCalledWith(
            expect.objectContaining({
                nextAttemptAt: "2024-01-18T12:00:00.000Z",
            }),
        );
    });

    test("records transient errors through release with backoff while the lease is held", async () => {
        const repository: Repository = createRepository([
            createJob(),
            createJob({ id: "job-2" }),
        ]);
        repository.blockIceberg.mockRejectedValueOnce(new Error("boom"));

        const result = await runDeletionJobs(repository as never, { now: NOW });

        expect(repository.release).toHaveBeenCalledTimes(1);
        expect(repository.release).toHaveBeenCalledWith({
            jobId: "job-1",
            leaseToken: "lease:job-1",
            nextAttemptAt: "2024-01-18T02:01:00.000Z",
            error: "boom",
        });
        expect(result.transientFailures).toBe(1);
        expect(result.markedIcebergBlocked).toBe(1);
        expect(result.rescheduled).toBe(1);
    });

    test("grows backoff from the job's attempt count", async () => {
        const repository: Repository = createRepository([
            createJob({ attemptCount: 4 }),
        ]);
        repository.blockIceberg.mockRejectedValue(new Error("boom"));

        await runDeletionJobs(repository as never, { now: NOW });

        expect(repository.release).toHaveBeenCalledTimes(1);
        expect(repository.release).toHaveBeenCalledWith({
            jobId: "job-1",
            leaseToken: "lease:job-1",
            nextAttemptAt: "2024-01-18T02:08:00.000Z",
            error: "boom",
        });
    });

    test("treats a null lease mutation as a lost lease without claiming success", async () => {
        const repository: Repository = createRepository([createJob()]);
        repository.blockIceberg.mockResolvedValue(null);

        const result = await runDeletionJobs(repository as never, { now: NOW });

        expect(repository.blockIceberg).toHaveBeenCalledTimes(1);
        expect(repository.release).not.toHaveBeenCalled();
        expect(result.lostLeases).toBe(1);
        expect(result.markedIcebergBlocked).toBe(0);
        expect(result.rescheduled).toBe(0);
        expect(result.transientFailures).toBe(0);
    });

    test("counts a lost lease when the error release is also reclaimed", async () => {
        const repository: Repository = createRepository([createJob()]);
        repository.blockIceberg.mockRejectedValue(new Error("boom"));
        repository.release.mockResolvedValue(null);

        const result = await runDeletionJobs(repository as never, { now: NOW });

        expect(result.transientFailures).toBe(0);
        expect(result.lostLeases).toBe(1);
    });

    test("treats a claimed job without a lease token as a lost lease", async () => {
        const repository = createRepository([createJob({ leaseToken: null })]);

        const result = await runDeletionJobs(repository as never, { now: NOW });

        expect(repository.blockIceberg).not.toHaveBeenCalled();
        expect(repository.release).not.toHaveBeenCalled();
        expect(result.lostLeases).toBe(1);
    });

    test("caps the number of jobs processed per run", async () => {
        const jobs = Array.from({ length: 5 }, (_, index) =>
            createJob({ id: `job-${index}` }),
        );
        const repository = createRepository(jobs);

        const result = await runDeletionJobs(repository as never, {
            limit: 3,
            now: NOW,
        });

        expect(repository.claim).toHaveBeenCalledWith({
            batchSize: 3,
            now: NOW.toISOString(),
            leaseDurationMs: DELETION_LEASE_DURATION_MS,
            owner: DELETION_LEASE_OWNER,
        });
        expect(repository.blockIceberg).toHaveBeenCalledTimes(3);
        expect(result.claimed).toBe(5);
        expect(result.markedIcebergBlocked).toBe(3);
    });

    test("clamps invalid and unbounded limits", async () => {
        const repository = createRepository([]);

        await runDeletionJobs(repository as never, { limit: 0, now: NOW });
        expect(repository.claim).toHaveBeenLastCalledWith(
            expect.objectContaining({ batchSize: 1 }),
        );

        await runDeletionJobs(repository as never, { limit: NaN, now: NOW });
        expect(repository.claim).toHaveBeenLastCalledWith(
            expect.objectContaining({ batchSize: DEFAULT_MAX_JOBS_PER_RUN }),
        );

        await runDeletionJobs(repository as never, { limit: 10_000, now: NOW });
        expect(repository.claim).toHaveBeenLastCalledWith(
            expect.objectContaining({ batchSize: MAX_JOBS_PER_RUN_LIMIT }),
        );
    });
});

describe("nextRetryDate", () => {
    test("applies exponential bounded backoff from the post-claim attempt count", () => {
        expect(nextRetryDate(1, NOW)).toEqual(
            new Date("2024-01-18T02:01:00.000Z"),
        );
        expect(nextRetryDate(2, NOW)).toEqual(
            new Date("2024-01-18T02:02:00.000Z"),
        );
        expect(nextRetryDate(4, NOW)).toEqual(
            new Date("2024-01-18T02:08:00.000Z"),
        );
        expect(nextRetryDate(100, NOW)).toEqual(
            new Date("2024-01-19T02:00:00.000Z"),
        );
    });
});

describe("rescheduleAt", () => {
    test("reschedules unfinished phases no later than 24 hours", () => {
        const job = createJob();
        expect(rescheduleAt(job as never, NOW)).toEqual(
            new Date("2024-01-19T02:00:00.000Z"),
        );
    });

    test("uses the earlier Analytics Engine expiry deadline", () => {
        const job = createJob({
            analyticsEngineExpiresAt: "2024-01-18T12:00:00.000Z",
        });
        expect(rescheduleAt(job as never, NOW)).toEqual(
            new Date("2024-01-18T12:00:00.000Z"),
        );
    });

    test("avoids tight reschedules for past or malformed deadlines", () => {
        const past = createJob({
            analyticsEngineExpiresAt: "2024-01-01T00:00:00.000Z",
        });
        expect(rescheduleAt(past as never, NOW)).toEqual(
            new Date("2024-01-18T03:00:00.000Z"),
        );

        const malformed = createJob({
            analyticsEngineExpiresAt: "not-a-date",
        });
        expect(rescheduleAt(malformed as never, NOW)).toEqual(
            new Date("2024-01-19T02:00:00.000Z"),
        );
    });
});
