import type { CloudflareClient } from "./cloudflare.js";
import {
    buildHistoricalSiteIdsQuery,
    parseHistoricalSiteIds,
    normalizeHistoricalSiteId,
    buildBackfillInsertBatches,
    validateDatasetIdentifier,
} from "./backfill.js";
import { normalizeTimezone } from "./validation.js";

export interface ProvisionSiteResult {
    site: Record<string, unknown>;
    created: boolean;
}

/** Default number of attempts for post-deploy site provisioning. */
export const DEFAULT_PROVISION_ATTEMPTS = 5;

const FATAL_4XX_RE = /HTTP (4\d\d)/;
const RETRYABLE_STATUS_RE = /HTTP (5\d\d|429|408)/;

/**
 * Classify a Sites API error as retryable. Deterministic 4xx (including auth)
 * failures are fatal and must not be retried. Network errors and 5xx/429/408
 * are transient and may be retried.
 */
export function isTransientSitesError(error: unknown): boolean {
    if (error instanceof TypeError) return true; // network-level failure
    const message = error instanceof Error ? error.message : String(error);
    if (FATAL_4XX_RE.test(message)) return false;
    return RETRYABLE_STATUS_RE.test(message);
}

export interface ProvisionRetryOptions {
    /** Total number of attempts (>= 1). */
    maxRetries?: number;
    /** Injectable backoff sleep, unit-testable without delays. */
    sleep?: (ms: number) => Promise<void>;
    /** Injectable retryability classifier. */
    isRetryable?: (error: unknown) => boolean;
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Idempotently provision a single site through the Sites API with bounded
 * retry/backoff. Every attempt is GET-before-POST so the operation stays
 * idempotent across retries (handles fresh workers.dev propagation and
 * transient network/5xx failures). Deterministic 4xx/auth failures are not
 * retried. After exhaustion the error states that the deploy succeeded and
 * rerunning the install is safe.
 */
export async function provisionSiteIdempotently(
    cloudflare: CloudflareClient,
    deployUrl: string,
    apiToken: string,
    domain: string,
    timezone: string,
    options: ProvisionRetryOptions = {},
): Promise<ProvisionSiteResult> {
    const maxRetries = Math.max(
        1,
        options.maxRetries ?? DEFAULT_PROVISION_ATTEMPTS,
    );
    const sleep = options.sleep ?? defaultSleep;
    const isRetryable = options.isRetryable ?? isTransientSitesError;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Idempotent GET-before-POST on every attempt.
            const existing = await cloudflare.getSiteByDomain(
                deployUrl,
                apiToken,
                domain,
            );
            if (existing) {
                return { site: existing, created: false };
            }
            const site = await cloudflare.createSite(
                deployUrl,
                apiToken,
                domain,
                timezone,
            );
            return { site, created: true };
        } catch (error) {
            lastError = error;
            if (attempt >= maxRetries || !isRetryable(error)) {
                break;
            }
            const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
            await sleep(backoff);
        }
    }

    throw new Error(
        `Initial site provisioning failed after ${maxRetries} attempt(s): ${
            lastError instanceof Error ? lastError.message : String(lastError)
        }. The deploy succeeded; rerunning noomers install is safe and idempotent.`,
    );
}

export interface DiscoveredSite {
    domain: string;
    timezone: string;
}

export interface BackfillPlan {
    dataset: string;
    sql: string;
    domains: string[];
    timezone: string;
}

/**
 * Discover the bounded set of distinct historical site IDs from Analytics
 * Engine, validate the dataset identifier, bound results, and validate each
 * discovered site ID as a domain. Empty/null site IDs are ignored; malformed
 * nonempty IDs cause a throw so they are never silently dropped. Domains are
 * deduplicated and sorted deterministically. Never mutates Analytics Engine.
 */
export async function discoverHistoricalSites(
    cloudflare: CloudflareClient,
    accountId: string,
    apiToken: string,
    dataset: string,
    timezone: string,
): Promise<BackfillPlan> {
    const safeDataset = validateDatasetIdentifier(dataset);
    const safeTimezone = normalizeTimezone(timezone);
    const sql = buildHistoricalSiteIdsQuery(safeDataset);
    const response = await cloudflare.queryAnalyticsEngine(
        accountId,
        apiToken,
        sql,
    );
    const rawIds = parseHistoricalSiteIds(response);
    const seen = new Set<string>();
    const domains: string[] = [];
    for (const raw of rawIds) {
        const domain = normalizeHistoricalSiteId(raw);
        if (domain === null) continue;
        if (!seen.has(domain)) {
            seen.add(domain);
            domains.push(domain);
        }
    }
    domains.sort();
    return {
        dataset: safeDataset,
        sql,
        domains,
        timezone: safeTimezone,
    };
}

/**
 * Apply a backfill plan by inserting sites directly into the deployed D1
 * database. Domains are applied in deterministic order in bounded batches, each
 * with its own rerun-safe insert that skips existing sites and permanent
 * tombstones. Execution is sequential and fail-closed: the first failed batch
 * aborts.
 */
export async function applyBackfill(
    cloudflare: CloudflareClient,
    databaseName: string,
    plan: BackfillPlan,
): Promise<void> {
    if (plan.domains.length === 0) return;
    const statements = buildBackfillInsertBatches(plan.domains, plan.timezone);
    for (const sql of statements) {
        await cloudflare.executeD1Statement(databaseName, sql);
    }
}

/**
 * The result of resolving the deployment-wide noomers API token.
 */
export interface TokenResolution {
    token: string;
    /**
     * True when the token was written to both STATS_API_TOKEN and
     * SITES_API_TOKEN during this run (fresh install). False on an existing
     * install, where the token was only accepted in memory for provisioning
     * and verification and never written or rotated.
     */
    stored: boolean;
}

/**
 * Resolve the noomers API token used for provisioning and verification.
 *
 * The token is always accepted from the user, never auto-generated and never
 * logged. On a fresh install (neither STATS_API_TOKEN nor SITES_API_TOKEN
 * present), securely prompt for a strong token and write the same value to
 * both secrets. On any existing install (one or both secrets present),
 * securely prompt for the existing token and never write or rotate anything;
 * if only one secret exists the missing one is not implicitly created.
 */
export async function resolveNoomersApiToken(
    secrets: Record<string, string>,
    deps: {
        promptNew: () => Promise<string>;
        promptExisting: () => Promise<string>;
        writeBoth: (token: string) => Promise<boolean>;
    },
): Promise<TokenResolution> {
    const hasStats = !!secrets.STATS_API_TOKEN;
    const hasSites = !!secrets.SITES_API_TOKEN;

    if (!hasStats && !hasSites) {
        const token = await deps.promptNew();
        const ok = await deps.writeBoth(token);
        if (!ok) {
            throw new Error("Error setting Stats/Sites API token");
        }
        return { token, stored: true };
    }

    const token = await deps.promptExisting();
    return { token, stored: false };
}

/**
 * Present the fail-closed upgrade backfill and gather confirmation. Discovery,
 * presentation, and confirmation all occur here. Any error, a malformed
 * nonempty ID, an over-bounds result, or a declined nonempty plan aborts by
 * throwing so the caller refuses to deploy with an incomplete registry.
 *
 * Returns the confirmed plan (to be applied once the D1 database exists), or
 * null when there is nothing to backfill.
 */
export async function presentBackfill(deps: {
    discover: () => Promise<BackfillPlan>;
    confirm: () => Promise<boolean>;
    log: (message: string) => void;
}): Promise<BackfillPlan | null> {
    const plan = await deps.discover();

    if (plan.domains.length === 0) {
        deps.log(
            "Upgrade backfill: no historical site IDs found; nothing to backfill.",
        );
        return null;
    }

    deps.log(
        `Upgrade backfill: found ${plan.domains.length} historical site candidate(s) from Analytics Engine.`,
    );
    deps.log(
        `Proposed domains (timezone ${plan.timezone}): ${plan.domains.join(", ")}. Inserts skip already-registered and permanently tombstoned domains.`,
    );

    const ok = await deps.confirm();
    if (ok !== true) {
        throw new Error(
            "Upgrade backfill declined. Refusing to deploy with an incomplete site registry; rerun noomers install to complete the backfill.",
        );
    }

    return plan;
}

/**
 * Provision the initial site and verify the deployment token authenticates
 * against the Sites API. Both must succeed; any failure throws so the install
 * fails clearly after deployment (the deploy has already happened, so the
 * caller should instruct rerun/remediation rather than printing a snippet).
 */
export async function provisionInitialSite(deps: {
    provision: () => Promise<ProvisionSiteResult>;
    verifyAuth: () => Promise<boolean>;
    log: (message: string) => void;
}): Promise<void> {
    const result = await deps.provision();
    deps.log(
        result.created
            ? "Provisioned initial site."
            : "Initial site already exists; no change.",
    );

    const authOk = await deps.verifyAuth();
    if (!authOk) {
        throw new Error(
            "Could not verify Sites API authentication with the deployment token. Check STATS_API_TOKEN/SITES_API_TOKEN and rerun noomers install.",
        );
    }
}
