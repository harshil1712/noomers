import { beforeEach, describe, expect, test, vi } from "vitest";

const { DeletionJobsRepository } = vi.hoisted(() => ({
    DeletionJobsRepository: vi.fn(),
}));

const { runDeletionJobs } = vi.hoisted(() => ({
    runDeletionJobs: vi.fn(),
}));

const { extractAsArrow } = vi.hoisted(() => ({
    extractAsArrow: vi.fn(),
}));

vi.mock("../../../app/deletion/repository", () => ({ DeletionJobsRepository }));
vi.mock("../deletion", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../deletion")>();
    return { ...actual, runDeletionJobs };
});
vi.mock("../arrow", () => ({ extractAsArrow }));

import { runScheduledJobs } from "../scheduled";

function createEnv(overrides: Record<string, unknown> = {}) {
    return {
        CF_STORAGE_ENABLED: "true",
        CF_ACCOUNT_ID: "acct-123",
        CF_BEARER_TOKEN: "token-456",
        GOALS_DB: { databaseId: "d1" },
        DAILY_ROLLUPS: { bucket: "rollups" },
        ...overrides,
    } as unknown as Env;
}

const EMPTY_RUN = {
    claimed: 0,
    markedIcebergBlocked: 0,
    rescheduled: 0,
    transientFailures: 0,
};

describe("runScheduledJobs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("runs deletion processing even when CF_STORAGE_ENABLED is false", async () => {
        runDeletionJobs.mockResolvedValue(EMPTY_RUN);
        const env = createEnv({ CF_STORAGE_ENABLED: "false" });

        const result = await runScheduledJobs(env);

        expect(runDeletionJobs).toHaveBeenCalledTimes(1);
        expect(DeletionJobsRepository).toHaveBeenCalledWith(env.GOALS_DB);
        expect(extractAsArrow).not.toHaveBeenCalled();
        expect(result.deletion.ok).toBe(true);
        expect(result.arrow).toEqual({ ok: true, skipped: true });
    });

    test("runs deletion and Arrow rollup when storage is enabled", async () => {
        runDeletionJobs.mockResolvedValue(EMPTY_RUN);
        extractAsArrow.mockResolvedValue({ filenames: ["f"], recordCount: 1 });
        const env = createEnv({ ANALYTICS_DATASET: "custom-dataset" });

        const result = await runScheduledJobs(env);

        expect(runDeletionJobs).toHaveBeenCalledTimes(1);
        expect(extractAsArrow).toHaveBeenCalledTimes(1);
        expect(extractAsArrow).toHaveBeenCalledWith(
            {
                accountId: "acct-123",
                bearerToken: "token-456",
                dataset: "custom-dataset",
            },
            env.DAILY_ROLLUPS,
        );
        expect(result.deletion.ok).toBe(true);
        expect(result.arrow).toEqual({
            ok: true,
            result: { filenames: ["f"], recordCount: 1 },
        });
    });

    test("defaults to metricsDataset when ANALYTICS_DATASET is not set", async () => {
        runDeletionJobs.mockResolvedValue(EMPTY_RUN);
        const env = createEnv();

        await runScheduledJobs(env);

        expect(extractAsArrow).toHaveBeenCalledWith(
            expect.objectContaining({ dataset: "metricsDataset" }),
            env.DAILY_ROLLUPS,
        );
    });

    test("keeps the Arrow rollup running when the storage flag is unset", async () => {
        runDeletionJobs.mockResolvedValue(EMPTY_RUN);
        const env = createEnv({ CF_STORAGE_ENABLED: undefined });

        await runScheduledJobs(env);

        expect(runDeletionJobs).toHaveBeenCalledTimes(1);
        expect(extractAsArrow).toHaveBeenCalledTimes(1);
    });

    test("deletion failure does not block the Arrow rollup", async () => {
        runDeletionJobs.mockRejectedValue(new Error("d1 down"));
        extractAsArrow.mockResolvedValue({ filenames: [], recordCount: 0 });
        const env = createEnv();

        const result = await runScheduledJobs(env);

        expect(result.deletion.ok).toBe(false);
        expect(result.deletion.error).toBe("d1 down");
        expect(result.arrow.ok).toBe(true);
    });

    test("Arrow rollup failure is captured without affecting deletion", async () => {
        runDeletionJobs.mockResolvedValue(EMPTY_RUN);
        extractAsArrow.mockRejectedValue(new Error("bucket timeout"));
        const env = createEnv();

        const result = await runScheduledJobs(env);

        expect(result.deletion.ok).toBe(true);
        expect(result.arrow.ok).toBe(false);
        expect(result.arrow.error).toBe("bucket timeout");
    });
});
