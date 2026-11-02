import { DeletionJobsRepository } from "../../app/deletion/repository";
import {
    runDeletionJobs,
    toErrorMessage,
    type DeletionRunResult,
} from "./deletion";

export interface DeletionOutcome {
    ok: boolean;
    error?: string;
    result?: DeletionRunResult;
}

export interface ScheduledJobsResult {
    deletion: DeletionOutcome;
}

export async function runScheduledJobs(env: Env): Promise<ScheduledJobsResult> {
    try {
        const repository = new DeletionJobsRepository(env.GOALS_DB);
        const result = await runDeletionJobs(repository);
        return { deletion: { ok: true, result } };
    } catch (error) {
        console.error("Deletion job processing failed:", error);
        return {
            deletion: { ok: false, error: toErrorMessage(error) },
        };
    }
}
