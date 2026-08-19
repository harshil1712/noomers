import type {
    DeletionJob,
    DeletionJobsRepository,
} from "../../app/deletion/repository";

/**
 * DEL-001: deletion-job claim and retry worker.
 *
 * Runs once per scheduled invocation and moves each claimed job as far as this
 * phase can: Iceberg row deletion (DEL-003) is recorded as `blocked` because no
 * writable Iceberg engine is provisioned, while daily-rollup deletion (DEL-002)
 * and Analytics Engine expiry completion (DEL-004) are left pending so those
 * roadmap items can drive them.
 *
 * The processor only ever mutates a job through the lease-token-guarded
 * `DeletionJobsRepository` methods and claims exactly once per run. `claim`
 * increments `attemptCount`; this processor never increments it again. A null
 * return from a guarded mutation means the lease was lost (reclaimed by another
 * scheduled run) and is counted as a lost lease, never as success.
 */

export const DEFAULT_MAX_JOBS_PER_RUN = 10;
export const MAX_JOBS_PER_RUN_LIMIT = 50;

export const DELETION_LEASE_DURATION_MS = 10 * 60_000;
export const DELETION_LEASE_OWNER = "noomers-deletion-worker";

export const ICEBERG_BLOCKED_MESSAGE =
    "blocked: no writable Iceberg engine provisioned; DEL-003 cannot proceed";

export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 24 * 60 * 60_000;
export const RESCHEDULE_MAX_DELAY_MS = 24 * 60 * 60_000;
export const MIN_RESCHEDULE_DELAY_MS = 60 * 60_000;

export interface DeletionRunOptions {
    limit?: number;
    now?: Date;
}

export interface DeletionRunResult {
    claimed: number;
    markedIcebergBlocked: number;
    rescheduled: number;
    transientFailures: number;
    lostLeases: number;
}

export async function runDeletionJobs(
    repository: DeletionJobsRepository,
    options: DeletionRunOptions = {},
): Promise<DeletionRunResult> {
    const limit = normalizeLimit(options.limit);
    const now = options.now ?? new Date();

    const jobs = await repository.claim({
        batchSize: limit,
        now: now.toISOString(),
        leaseDurationMs: DELETION_LEASE_DURATION_MS,
        owner: DELETION_LEASE_OWNER,
    });
    const result: DeletionRunResult = {
        claimed: jobs.length,
        markedIcebergBlocked: 0,
        rescheduled: 0,
        transientFailures: 0,
        lostLeases: 0,
    };

    for (const job of jobs.slice(0, limit)) {
        const leaseToken = job.leaseToken;
        if (!leaseToken) {
            result.lostLeases += 1;
            continue;
        }
        try {
            const mutation = await advanceJob(repository, job, leaseToken, now);
            if (!mutation) {
                result.lostLeases += 1;
                continue;
            }
            if (job.icebergStatus === "pending") {
                result.markedIcebergBlocked += 1;
            }
            result.rescheduled += 1;
        } catch (error) {
            await recordTransientError(
                repository,
                job,
                leaseToken,
                error,
                now,
                result,
            );
        }
    }

    console.log(
        `Deletion run complete: claimed=${result.claimed} ` +
            `markedIcebergBlocked=${result.markedIcebergBlocked} ` +
            `rescheduled=${result.rescheduled} ` +
            `transientFailures=${result.transientFailures} ` +
            `lostLeases=${result.lostLeases}`,
    );
    return result;
}

async function advanceJob(
    repository: DeletionJobsRepository,
    job: DeletionJob,
    leaseToken: string,
    now: Date,
): Promise<DeletionJob | null> {
    const at = now.toISOString();
    const nextAttemptAt = rescheduleAt(job, now).toISOString();
    if (job.icebergStatus === "pending") {
        return repository.blockIceberg({
            jobId: job.id,
            leaseToken,
            at,
            error: ICEBERG_BLOCKED_MESSAGE,
            nextAttemptAt,
        });
    }
    return repository.release({
        jobId: job.id,
        leaseToken,
        nextAttemptAt,
    });
}

async function recordTransientError(
    repository: DeletionJobsRepository,
    job: DeletionJob,
    leaseToken: string,
    error: unknown,
    now: Date,
    result: DeletionRunResult,
): Promise<void> {
    try {
        const mutation = await repository.release({
            jobId: job.id,
            leaseToken,
            nextAttemptAt: nextRetryDate(job.attemptCount, now).toISOString(),
            error: toErrorMessage(error),
        });
        if (!mutation) {
            result.lostLeases += 1;
        } else {
            result.transientFailures += 1;
        }
    } catch {
        result.lostLeases += 1;
    }
}

export function nextRetryDate(attemptCount: number, now: Date): Date {
    const delayMs = Math.min(
        BACKOFF_MAX_MS,
        BACKOFF_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
    );
    return new Date(now.getTime() + delayMs);
}

export function rescheduleAt(job: DeletionJob, now: Date): Date {
    const expiresAt = new Date(job.analyticsEngineExpiresAt);
    const latest = new Date(now.getTime() + RESCHEDULE_MAX_DELAY_MS);
    const minimum = new Date(now.getTime() + MIN_RESCHEDULE_DELAY_MS);
    if (Number.isNaN(expiresAt.getTime())) {
        return latest;
    }
    const candidate = expiresAt < latest ? expiresAt : latest;
    return candidate > minimum ? candidate : minimum;
}

export function toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function normalizeLimit(limit?: number): number {
    if (limit === undefined || !Number.isInteger(limit)) {
        return DEFAULT_MAX_JOBS_PER_RUN;
    }
    return Math.min(MAX_JOBS_PER_RUN_LIMIT, Math.max(1, limit));
}
