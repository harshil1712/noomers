import { DeletionJobsRepository } from "../../app/deletion/repository";
import { extractAsArrow } from "./arrow";
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

export interface ArrowOutcome {
    ok: boolean;
    skipped?: boolean;
    error?: string;
    result?: Awaited<ReturnType<typeof extractAsArrow>>;
}

export interface ScheduledJobsResult {
    deletion: DeletionOutcome;
    arrow: ArrowOutcome;
}

export async function runScheduledJobs(env: Env): Promise<ScheduledJobsResult> {
    const deletion = await runDeletion(env);
    const arrow =
        env.CF_STORAGE_ENABLED === "false"
            ? { ok: true, skipped: true }
            : await runArrow(env);
    return { deletion, arrow };
}

async function runDeletion(env: Env): Promise<DeletionOutcome> {
    try {
        const repository = new DeletionJobsRepository(env.GOALS_DB);
        const result = await runDeletionJobs(repository);
        return { ok: true, result };
    } catch (error) {
        console.error("Deletion job processing failed:", error);
        return { ok: false, error: toErrorMessage(error) };
    }
}

async function runArrow(env: Env): Promise<ArrowOutcome> {
    try {
        const result = await extractAsArrow(
            {
                accountId: env.CF_ACCOUNT_ID,
                bearerToken: env.CF_BEARER_TOKEN,
            },
            env.DAILY_ROLLUPS,
        );
        return { ok: true, result };
    } catch (error) {
        console.error(error);
        return { ok: false, error: toErrorMessage(error) };
    }
}
