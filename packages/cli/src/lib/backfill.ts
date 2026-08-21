import { normalizeDomain, validateDatasetIdentifier } from "./validation.js";

export { validateDatasetIdentifier };

/**
 * Safe upgrade backfill for existing noomers deployments.
 *
 * Before fail-closed collection (which relies on the D1 site registry) ships,
 * an existing deployment may already have written events to Analytics Engine
 * under site IDs that are not yet present in D1. This module reconstructs the
 * bounded set of historical site IDs from Analytics Engine and builds rerun-safe
 * D1 statements that insert them without disturbing existing sites or permanent
 * tombstones.
 *
 * Backfill is fail-closed: a malformed nonempty site ID, an over-bounds result,
 * a 200 response carrying errors, or a failed insertion must abort the install
 * rather than deploy with an incomplete registry.
 */

/**
 * The maximum number of distinct historical site IDs we will accept before
 * failing clearly. One sentinel row is requested so we can detect that the
 * result was truncated.
 */
export const BACKFILL_LIMIT = 1000;
export const BACKFILL_LIMIT_SENTINEL = BACKFILL_LIMIT + 1;

/**
 * The number of candidate domains per generated D1 insert statement. Batches
 * keep each `wrangler d1 execute --command` payload bounded while preserving
 * per-batch idempotency and tombstone checks.
 */
export const BACKFILL_BATCH_SIZE = 100;

/**
 * Build the Analytics Engine SQL query that returns distinct historical site
 * IDs (blob8) from the configured dataset, bounded by BACKFILL_LIMIT_SENTINEL.
 * The dataset identifier is validated and quoted with double quotes before
 * interpolation.
 */
export function buildHistoricalSiteIdsQuery(dataset: string): string {
    const safeDataset = validateDatasetIdentifier(dataset);
    return [
        "SELECT blob8 AS siteId",
        `FROM "${safeDataset}"`,
        "GROUP BY blob8",
        `LIMIT ${BACKFILL_LIMIT_SENTINEL}`,
    ].join(" ");
}

/**
 * The Analytics Engine SQL API response shape, matching what the server's
 * query.ts consumes: `data` is an array of objects (aliased columns), `rows`
 * is a count, and `meta` is a string. `errors` may carry API errors even on an
 * HTTP 200 response and must be treated as a failure.
 */
export interface AnalyticsEngineQueryResponse {
    data?: Array<Record<string, unknown>>;
    rows?: number;
    meta?: string;
    rows_before_limit_at_least?: number;
    errors?: unknown;
}

/**
 * Return true when the Analytics Engine response body carries a nonempty
 * `errors` field. Handles both an array and an object-shaped error payload.
 */
export function hasAnalyticsEngineErrors(
    response: AnalyticsEngineQueryResponse,
): boolean {
    const errors = response.errors;
    if (Array.isArray(errors)) return errors.length > 0;
    if (errors === null || errors === undefined) return false;
    if (typeof errors === "object") return Object.keys(errors).length > 0;
    return Boolean(errors);
}

/**
 * Extract distinct site IDs from an Analytics Engine SQL response. Throws
 * fail-closed when the 200 response body carries a nonempty `errors` field,
 * when the result is provably truncated (more rows than the sentinel limit),
 * or when `data` is not an array of objects. Reads the `siteId` alias from each
 * row; `rows` is a count and is not used for row extraction.
 */
export function parseHistoricalSiteIds(
    response: AnalyticsEngineQueryResponse,
    limit: number = BACKFILL_LIMIT,
): unknown[] {
    if (hasAnalyticsEngineErrors(response)) {
        throw new Error(
            "Analytics Engine returned errors in the response body. Refusing to backfill automatically.",
        );
    }

    if (!Array.isArray(response.data)) {
        throw new Error(
            "Analytics Engine returned an unrecognized query response shape.",
        );
    }

    const values = response.data.map(
        (row) => (row as Record<string, unknown>).siteId,
    );

    if (values.length > limit) {
        throw new Error(
            `More than ${limit} distinct historical site IDs were found. Refusing to backfill automatically; please review your Analytics Engine dataset and register sites explicitly.`,
        );
    }

    return values;
}

/**
 * Normalize and validate a raw Analytics Engine site ID (a blob8 value) as a
 * domain. Empty or null blob8 values are ignored (returns null). Any other
 * value must normalize to a valid domain; a malformed nonempty ID throws so it
 * is never silently dropped from a backfill.
 */
export function normalizeHistoricalSiteId(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") {
        throw new Error(
            `Historical site ID is not a string; refusing to silently drop it.`,
        );
    }
    if (value.trim() === "") return null;
    try {
        return normalizeDomain(value);
    } catch {
        throw new Error(
            `Invalid historical site ID "${value}" found; refusing to silently drop it.`,
        );
    }
}

/**
 * Build a rerun-safe D1 (SQLite) statement that inserts the given sites only
 * when they are not already present and not permanently tombstoned.
 *
 * Mirrors SitesRepository.create but runs against the deployed D1 database
 * before the registry-dependent deployment is live. Each candidate generates a
 * fresh tracker UUID and the default tracker configuration. The derived table
 * uses a column aliased in the first SELECT (not a derived column list) so the
 * statement is valid SQLite, and WHERE NOT EXISTS against both `sites` and
 * `site_tombstones` keeps it safe to rerun.
 */
export function buildBackfillInsertStatement(
    domains: string[],
    timezone: string,
): string {
    const values = domains
        .map(
            (domain) =>
                `SELECT '${escapeSqlString(domain)}' AS domain, '${crypto.randomUUID()}' AS tracker_id, '${escapeSqlString(timezone)}' AS timezone, '{}' AS tracker_script_configuration`,
        )
        .join(" UNION ALL ");

    return [
        "INSERT INTO sites (domain, tracker_id, timezone, tracker_script_configuration)",
        "SELECT domain, tracker_id, timezone, tracker_script_configuration",
        "FROM (",
        values,
        ") AS candidate",
        "WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.domain = candidate.domain)",
        "AND NOT EXISTS (SELECT 1 FROM site_tombstones t WHERE t.domain = candidate.domain)",
    ].join(" ");
}

/**
 * Split the given domains into deterministic batches of at most
 * BACKFILL_BATCH_SIZE and build one insert statement per batch. Batching keeps
 * each `wrangler d1 execute --command` payload bounded; every batch preserves
 * the per-batch idempotency and tombstone checks.
 */
export function buildBackfillInsertBatches(
    domains: string[],
    timezone: string,
    batchSize: number = BACKFILL_BATCH_SIZE,
): string[] {
    if (!Number.isInteger(batchSize) || batchSize < 1) {
        throw new Error("batchSize must be a positive integer.");
    }
    const batches: string[] = [];
    for (let i = 0; i < domains.length; i += batchSize) {
        batches.push(
            buildBackfillInsertStatement(
                domains.slice(i, i + batchSize),
                timezone,
            ),
        );
    }
    return batches;
}

/**
 * Escape a string literal for use inside a single-quoted SQL value. This is
 * used only for values already validated as domains/timezones, but double the
 * quotes defensively so a future call site can never break out of the literal.
 */
export function escapeSqlString(value: string): string {
    return value.replace(/'/g, "''");
}
