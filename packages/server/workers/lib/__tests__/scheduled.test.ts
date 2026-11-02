import { beforeEach, describe, expect, test, vi } from "vitest";

const { DeletionJobsRepository } = vi.hoisted(() => ({
    DeletionJobsRepository: vi.fn(),
}));

const { runDeletionJobs } = vi.hoisted(() => ({
    runDeletionJobs: vi.fn(),
}));

vi.mock("../../../app/deletion/repository", () => ({ DeletionJobsRepository }));
vi.mock("../deletion", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../deletion")>();
    return { ...actual, runDeletionJobs };
});

import { runScheduledJobs } from "../scheduled";

function createEnv(overrides: Record<string, unknown> = {}) {
    return {
        GOALS_DB: { databaseId: "d1" },
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

    test("runs deletion processing", async () => {
        runDeletionJobs.mockResolvedValue(EMPTY_RUN);
        const result = await runScheduledJobs(createEnv());
        expect(runDeletionJobs).toHaveBeenCalledTimes(1);
        expect(DeletionJobsRepository).toHaveBeenCalledWith(
            createEnv().GOALS_DB,
        );
        expect(result.deletion.ok).toBe(true);
    });

    test("reports deletion failures", async () => {
        runDeletionJobs.mockRejectedValue(new Error("d1 down"));
        const result = await runScheduledJobs(createEnv());
        expect(result.deletion.ok).toBe(false);
        expect(result.deletion.error).toContain("d1 down");
    });
});
