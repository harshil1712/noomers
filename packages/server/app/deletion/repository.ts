export const ANALYTICS_ENGINE_STATUSES = ["pending_expiry", "expired"] as const;
export type AnalyticsEngineStatus = (typeof ANALYTICS_ENGINE_STATUSES)[number];

export const ICEBERG_STATUSES = [
    "pending",
    "blocked",
    "completed",
    "failed",
] as const;
export type IcebergStatus = (typeof ICEBERG_STATUSES)[number];

export const DAILY_ROLLUP_STATUSES = [
    "pending",
    "completed",
    "failed",
] as const;
export type DailyRollupStatus = (typeof DAILY_ROLLUP_STATUSES)[number];

export interface DeletionJob {
    id: string;
    siteId: string;
    requestedAt: string;
    analyticsEngineStatus: AnalyticsEngineStatus;
    analyticsEngineExpiresAt: string;
    icebergStatus: IcebergStatus;
    icebergUpdatedAt: string | null;
    icebergError: string | null;
    dailyRollupStatus: DailyRollupStatus;
    dailyRollupUpdatedAt: string | null;
    dailyRollupError: string | null;
    attemptCount: number;
    nextAttemptAt: string;
    lastError: string | null;
    leaseToken: string | null;
    leaseOwner: string | null;
    leaseExpiresAt: string | null;
    leaseAcquiredAt: string | null;
    completedAt: string | null;
}

interface DeletionJobRow {
    id: string;
    site_id: string;
    requested_at: string;
    analytics_engine_status: AnalyticsEngineStatus;
    analytics_engine_expires_at: string;
    iceberg_status: IcebergStatus;
    iceberg_updated_at: string | null;
    iceberg_error: string | null;
    daily_rollup_status: DailyRollupStatus;
    daily_rollup_updated_at: string | null;
    daily_rollup_error: string | null;
    attempt_count: number;
    next_attempt_at: string;
    last_error: string | null;
    lease_token: string | null;
    lease_owner: string | null;
    lease_expires_at: string | null;
    lease_acquired_at: string | null;
    completed_at: string | null;
}

export interface ClaimInput {
    batchSize: number;
    now: string;
    leaseDurationMs: number;
    owner: string;
    leaseTokenPrefix?: string;
}

export interface GuardedLayerSuccessInput {
    jobId: string;
    leaseToken: string;
    at: string;
}

export interface GuardedLayerFailureInput extends GuardedLayerSuccessInput {
    error: string;
    nextAttemptAt: string;
}

export interface TerminalCompletionInput {
    jobId: string;
    leaseToken: string;
    at: string;
}

export interface ReleaseInput {
    jobId: string;
    leaseToken: string;
    nextAttemptAt: string;
    error?: string | null;
}

const MAX_CLAIM_BATCH = 100;

function assertValidTime(value: string, label: string): void {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw new Error(`${label} must be a valid ISO timestamp.`);
    }
}

function assertJobIdAndLease(jobId: string, leaseToken: string): void {
    if (typeof jobId !== "string" || !jobId) {
        throw new Error("jobId is required.");
    }
    if (typeof leaseToken !== "string" || !leaseToken) {
        throw new Error("leaseToken is required.");
    }
}

function toDeletionJob(row: DeletionJobRow): DeletionJob {
    return {
        id: row.id,
        siteId: row.site_id,
        requestedAt: row.requested_at,
        analyticsEngineStatus: row.analytics_engine_status,
        analyticsEngineExpiresAt: row.analytics_engine_expires_at,
        icebergStatus: row.iceberg_status,
        icebergUpdatedAt: row.iceberg_updated_at,
        icebergError: row.iceberg_error,
        dailyRollupStatus: row.daily_rollup_status,
        dailyRollupUpdatedAt: row.daily_rollup_updated_at,
        dailyRollupError: row.daily_rollup_error,
        attemptCount: row.attempt_count,
        nextAttemptAt: row.next_attempt_at,
        lastError: row.last_error,
        leaseToken: row.lease_token,
        leaseOwner: row.lease_owner,
        leaseExpiresAt: row.lease_expires_at,
        leaseAcquiredAt: row.lease_acquired_at,
        completedAt: row.completed_at,
    };
}

/**
 * Typed repository over the DEL-005 `site_deletion_jobs` schema.
 *
 * Claim semantics are safe under concurrent D1 callers: a single conditional
 * `UPDATE ... RETURNING` claims only jobs that are not yet completed, are due
 * (`next_attempt_at` in the past), and either have no lease or a stale one.
 * Each claim hands out a unique, row-scoped lease token; every later mutation
 * is guarded by that token so a worker whose lease was reclaimed can never
 * mutate the job.
 */
export class DeletionJobsRepository {
    constructor(private database: D1Database) {}

    async claim(input: ClaimInput): Promise<DeletionJob[]> {
        const { batchSize, now, leaseDurationMs, owner, leaseTokenPrefix } =
            input;
        if (
            !Number.isInteger(batchSize) ||
            batchSize < 1 ||
            batchSize > MAX_CLAIM_BATCH
        ) {
            throw new Error(
                `batchSize must be an integer between 1 and ${MAX_CLAIM_BATCH}.`,
            );
        }
        if (!Number.isInteger(leaseDurationMs) || leaseDurationMs <= 0) {
            throw new Error("leaseDurationMs must be a positive integer.");
        }
        assertValidTime(now, "now");
        if (typeof owner !== "string" || !owner) {
            throw new Error("owner is required.");
        }
        const prefix =
            leaseTokenPrefix === undefined
                ? crypto.randomUUID()
                : leaseTokenPrefix;
        if (typeof prefix !== "string" || !prefix) {
            throw new Error("leaseTokenPrefix must be a non-empty string.");
        }
        const leaseExpiresAt = new Date(
            Date.parse(now) + leaseDurationMs,
        ).toISOString();
        const result = await this.database
            .prepare(
                `UPDATE site_deletion_jobs
                 SET lease_token = ?1 || ':' || id,
                     lease_owner = ?2,
                     lease_acquired_at = ?3,
                     lease_expires_at = ?4,
                     attempt_count = attempt_count + 1
                 WHERE completed_at IS NULL
                   AND next_attempt_at <= ?3
                   AND (lease_token IS NULL OR lease_expires_at <= ?3)
                   AND id IN (
                       SELECT id FROM site_deletion_jobs
                       WHERE completed_at IS NULL
                         AND next_attempt_at <= ?3
                         AND (lease_token IS NULL OR lease_expires_at <= ?3)
                       ORDER BY next_attempt_at ASC
                       LIMIT ?5
                   )
                 RETURNING *`,
            )
            .bind(prefix, owner, now, leaseExpiresAt, batchSize)
            .all<DeletionJobRow>();
        return result.results.map(toDeletionJob);
    }

    async get(id: string): Promise<DeletionJob | null> {
        if (!id) throw new Error("id is required.");
        const row = await this.database
            .prepare("SELECT * FROM site_deletion_jobs WHERE id = ?")
            .bind(id)
            .first<DeletionJobRow>();
        return row ? toDeletionJob(row) : null;
    }

    async getBySiteId(siteId: string): Promise<DeletionJob | null> {
        if (!siteId) throw new Error("siteId is required.");
        const row = await this.database
            .prepare("SELECT * FROM site_deletion_jobs WHERE site_id = ?")
            .bind(siteId)
            .first<DeletionJobRow>();
        return row ? toDeletionJob(row) : null;
    }

    async completeDailyRollup(
        input: GuardedLayerSuccessInput,
    ): Promise<DeletionJob | null> {
        const { jobId, leaseToken, at } = this.validateLayerSuccess(input);
        return this.leasedUpdate(
            `UPDATE site_deletion_jobs
             SET daily_rollup_status = 'completed',
                 daily_rollup_updated_at = ?1,
                 daily_rollup_error = NULL,
                 last_error = NULL
             WHERE id = ?2 AND lease_token = ?3
             RETURNING *`,
            [at, jobId, leaseToken],
        );
    }

    async failDailyRollup(
        input: GuardedLayerFailureInput,
    ): Promise<DeletionJob | null> {
        const { jobId, leaseToken, at, error, nextAttemptAt } =
            this.validateLayerFailure(input);
        return this.leasedUpdate(
            `UPDATE site_deletion_jobs
             SET daily_rollup_status = 'failed',
                 daily_rollup_updated_at = ?1,
                 daily_rollup_error = ?2,
                 last_error = ?2,
                 next_attempt_at = ?3,
                 lease_token = NULL,
                 lease_owner = NULL,
                 lease_acquired_at = NULL,
                 lease_expires_at = NULL
             WHERE id = ?4 AND lease_token = ?5
             RETURNING *`,
            [at, error, nextAttemptAt, jobId, leaseToken],
        );
    }

    async completeIceberg(
        input: GuardedLayerSuccessInput,
    ): Promise<DeletionJob | null> {
        const { jobId, leaseToken, at } = this.validateLayerSuccess(input);
        return this.leasedUpdate(
            `UPDATE site_deletion_jobs
             SET iceberg_status = 'completed',
                 iceberg_updated_at = ?1,
                 iceberg_error = NULL,
                 last_error = NULL
             WHERE id = ?2 AND lease_token = ?3
             RETURNING *`,
            [at, jobId, leaseToken],
        );
    }

    async failIceberg(
        input: GuardedLayerFailureInput,
    ): Promise<DeletionJob | null> {
        const { jobId, leaseToken, at, error, nextAttemptAt } =
            this.validateLayerFailure(input);
        return this.leasedUpdate(
            `UPDATE site_deletion_jobs
             SET iceberg_status = 'failed',
                 iceberg_updated_at = ?1,
                 iceberg_error = ?2,
                 last_error = ?2,
                 next_attempt_at = ?3,
                 lease_token = NULL,
                 lease_owner = NULL,
                 lease_acquired_at = NULL,
                 lease_expires_at = NULL
             WHERE id = ?4 AND lease_token = ?5
             RETURNING *`,
            [at, error, nextAttemptAt, jobId, leaseToken],
        );
    }

    async blockIceberg(
        input: GuardedLayerFailureInput,
    ): Promise<DeletionJob | null> {
        const { jobId, leaseToken, at, error, nextAttemptAt } =
            this.validateLayerFailure(input);
        return this.leasedUpdate(
            `UPDATE site_deletion_jobs
             SET iceberg_status = 'blocked',
                 iceberg_updated_at = ?1,
                 iceberg_error = ?2,
                 last_error = ?2,
                 next_attempt_at = ?3,
                 lease_token = NULL,
                 lease_owner = NULL,
                 lease_acquired_at = NULL,
                 lease_expires_at = NULL
             WHERE id = ?4 AND lease_token = ?5
             RETURNING *`,
            [at, error, nextAttemptAt, jobId, leaseToken],
        );
    }

    async expireAnalyticsEngine(
        input: GuardedLayerSuccessInput,
    ): Promise<DeletionJob | null> {
        const { jobId, leaseToken, at } = this.validateLayerSuccess(input);
        return this.leasedUpdate(
            `UPDATE site_deletion_jobs
             SET analytics_engine_status = 'expired',
                 last_error = NULL
             WHERE id = ?1 AND lease_token = ?2
               AND analytics_engine_status = 'pending_expiry'
               AND analytics_engine_expires_at <= ?3
             RETURNING *`,
            [jobId, leaseToken, at],
        );
    }

    async complete(
        input: TerminalCompletionInput,
    ): Promise<DeletionJob | null> {
        const { jobId, leaseToken, at } = input;
        assertJobIdAndLease(jobId, leaseToken);
        assertValidTime(at, "at");
        return this.leasedUpdate(
            `UPDATE site_deletion_jobs
             SET completed_at = ?1,
                 next_attempt_at = ?1,
                 last_error = NULL,
                 lease_token = NULL,
                 lease_owner = NULL,
                 lease_acquired_at = NULL,
                 lease_expires_at = NULL
             WHERE id = ?2 AND lease_token = ?3
               AND completed_at IS NULL
               AND daily_rollup_status = 'completed'
               AND iceberg_status = 'completed'
               AND analytics_engine_status = 'expired'
             RETURNING *`,
            [at, jobId, leaseToken],
        );
    }

    async release(input: ReleaseInput): Promise<DeletionJob | null> {
        const { jobId, leaseToken, nextAttemptAt, error } = input;
        assertJobIdAndLease(jobId, leaseToken);
        assertValidTime(nextAttemptAt, "nextAttemptAt");
        const updatesError = error !== undefined;
        return this.leasedUpdate(
            `UPDATE site_deletion_jobs
              SET next_attempt_at = ?1,
                  last_error = CASE WHEN ?2 = 1 THEN ?3 ELSE last_error END,
                  lease_token = NULL,
                  lease_owner = NULL,
                  lease_acquired_at = NULL,
                  lease_expires_at = NULL
              WHERE id = ?4 AND lease_token = ?5
              RETURNING *`,
            [
                nextAttemptAt,
                updatesError ? 1 : 0,
                error ?? null,
                jobId,
                leaseToken,
            ],
        );
    }

    private validateLayerSuccess(
        input: GuardedLayerSuccessInput,
    ): GuardedLayerSuccessInput {
        assertJobIdAndLease(input.jobId, input.leaseToken);
        assertValidTime(input.at, "at");
        return input;
    }

    private validateLayerFailure(
        input: GuardedLayerFailureInput,
    ): GuardedLayerFailureInput {
        assertJobIdAndLease(input.jobId, input.leaseToken);
        assertValidTime(input.at, "at");
        assertValidTime(input.nextAttemptAt, "nextAttemptAt");
        if (typeof input.error !== "string" || !input.error) {
            throw new Error("error is required.");
        }
        return input;
    }

    private async leasedUpdate(
        sql: string,
        params: unknown[],
    ): Promise<DeletionJob | null> {
        const row = await this.database
            .prepare(sql)
            .bind(...params)
            .first<DeletionJobRow>();
        return row ? toDeletionJob(row) : null;
    }
}
