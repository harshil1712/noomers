/**
 * Operator-triggered live validation of a deployed noomers server.
 *
 * All checks are read-only: no sites are created, no events are collected, and
 * no resources are written. Validation confirms that the configured HTTP
 * surface is reachable and that the configured Sites/Stats credentials
 * authenticate, but it does NOT prove durable delivery (Analytics Engine
 * ingestion, Pipeline/Iceberg, or R2 SQL persistence) now or in the future.
 */

export interface ValidateOptions {
    /** Deployment base URL, e.g. https://app.example.workers.dev. */
    url: string;
    /** The exact site domain that must already exist in the registry. */
    site: string;
    /** API token. Read only from NOOMERS_API_TOKEN by callers, never a CLI option. */
    apiToken: string;
    /** When true, skip the durable (R2 SQL) exact-session-metric check. */
    skipDurable?: boolean;
    /** Bounded timeout in milliseconds for each request. Must be a positive finite number. */
    timeoutMs?: number;
    /** Injectable fetch for unit testing. */
    fetchFn?: typeof fetch;
}

export interface ValidateResult {
    checks: Array<{
        name: string;
        status: "ok";
        detail?: string;
    }>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

const HEALTH_PATH = "/api/health";
const SITES_PATH = "/api/v1/sites";
const QUERY_PATH = "/api/v2/query";

const AE_QUERY_BODY = {
    site_id: "",
    metrics: ["visitors", "pageviews", "events"],
    date_range: "24h",
};

const DURABLE_QUERY_BODY = {
    site_id: "",
    metrics: ["visits"],
    date_range: "24h",
};

/**
 * Validate a deployment URL. Rejects credentials, query strings, and hashes.
 * Requires HTTPS except for localhost and 127.0.0.1.
 */
export function validateDeploymentUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(
            "A valid deployment URL is required (for example https://app.example.workers.dev).",
        );
    }

    if (url.username || url.password) {
        throw new Error("Deployment URL must not contain credentials.");
    }
    if (url.search) {
        throw new Error("Deployment URL must not contain a query string.");
    }
    if (url.hash) {
        throw new Error("Deployment URL must not contain a fragment.");
    }
    if (url.pathname !== "/" && url.pathname !== "") {
        throw new Error("Deployment URL must not contain a path.");
    }

    const host = url.hostname;
    const isLoopback = host === "localhost" || host === "127.0.0.1";
    if (url.protocol !== "https:" && !isLoopback) {
        throw new Error(
            "Deployment URL must use HTTPS except for localhost or 127.0.0.1.",
        );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Deployment URL must use http or https.");
    }

    return url.origin;
}

/**
 * Validate a positive finite timeout. Defaults to DEFAULT_TIMEOUT_MS when
 * omitted and throws when the value is not a positive finite number.
 */
function resolveTimeoutMs(value: number | undefined): number {
    if (value === undefined) return DEFAULT_TIMEOUT_MS;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error("timeoutMs must be a positive finite number.");
    }
    return value;
}

/**
 * Perform a bounded fetch. Treats network failures, timeouts, and non-2xx
 * responses as failures. Returns the parsed JSON body for 2xx responses.
 */
async function boundedFetch(
    fetchFn: typeof fetch,
    input: string,
    init: RequestInit,
    timeoutMs: number,
): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
        response = await fetchFn(input, {
            ...init,
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error(`Request timed out after ${timeoutMs}ms.`);
        }
        throw new Error(
            `Request failed: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        throw new Error(`Unexpected HTTP ${response.status} from ${input}.`);
    }

    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            `Expected a JSON response from ${input} but received non-JSON content.`,
        );
    }
}

function expectFiniteNumber(value: unknown, label: string): void {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Malformed ${label}: expected a finite number.`);
    }
}

/**
 * Strictly validate a Stats API /api/v2/query aggregate response.
 *
 * Requires exactly one result row whose dimensions array is empty, and
 * exactly `expectedMetrics` finite metrics. Any deviation (missing results,
 * extra rows, non-empty dimensions, empty metrics, or a wrong metric count)
 * is treated as a malformed response and throws.
 */
function expectAggregateMetricsResult(
    body: unknown,
    label: string,
    expectedMetrics: number,
): void {
    const obj = body as Record<string, unknown>;
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.results)) {
        throw new Error(`${label} returned a malformed response shape.`);
    }
    const results = obj.results as Array<Record<string, unknown>>;
    if (results.length !== 1) {
        throw new Error(
            `${label} returned ${results.length} result rows; expected exactly 1.`,
        );
    }
    const first = results[0];
    if (!first || typeof first !== "object") {
        throw new Error(`${label} returned a malformed result row.`);
    }
    if (!Array.isArray(first.dimensions) || first.dimensions.length !== 0) {
        throw new Error(
            `${label} returned malformed dimensions; expected an empty array.`,
        );
    }
    if (!Array.isArray(first.metrics)) {
        throw new Error(`${label} returned malformed metrics.`);
    }
    if (first.metrics.length !== expectedMetrics) {
        throw new Error(
            `${label} returned ${first.metrics.length} metrics; expected exactly ${expectedMetrics}.`,
        );
    }
    for (let i = 0; i < first.metrics.length; i++) {
        expectFiniteNumber(first.metrics[i], `${label} metrics[${i}]`);
    }
}

/**
 * Run the read-only validation checks against the deployed server.
 */
export async function validateDeployment(
    options: ValidateOptions,
): Promise<ValidateResult> {
    const fetchFn = options.fetchFn ?? fetch;
    const timeoutMs = resolveTimeoutMs(options.timeoutMs);
    const origin = validateDeploymentUrl(options.url);
    const token = options.apiToken;
    const authHeaders = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };

    if (!token) {
        throw new Error(
            "NOOMERS_API_TOKEN is required to validate the Sites/Stats API.",
        );
    }

    const checks: ValidateResult["checks"] = [];

    // 1. Liveness. Liveness-only: does not prove D1, Analytics Engine, R2 SQL,
    //    or Pipeline health.
    {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
            response = await fetchFn(`${origin}${HEALTH_PATH}`, {
                method: "GET",
                signal: controller.signal,
            });
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(
                    `Health request timed out after ${timeoutMs}ms.`,
                );
            }
            throw new Error(
                `Health request failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            throw new Error(
                `Health check failed: unexpected HTTP ${response.status}.`,
            );
        }
        const text = await response.text();
        if (text.trim() !== "ok") {
            throw new Error(
                `Health check returned an unexpected body (liveness only).`,
            );
        }
        checks.push({ name: "health", status: "ok" });
    }

    // 2. Sites detail: fetch the exact site from the read-only detail endpoint
    //    and strictly verify the returned domain equals the requested site.
    {
        const encodedSite = encodeURIComponent(options.site);
        const body = await boundedFetch(
            fetchFn,
            `${origin}${SITES_PATH}/${encodedSite}`,
            { method: "GET", headers: authHeaders },
            timeoutMs,
        );
        const site = body as Record<string, unknown>;
        if (!site || typeof site !== "object" || Array.isArray(site)) {
            throw new Error(
                "Sites detail returned a malformed response shape.",
            );
        }
        if (site.domain !== options.site) {
            throw new Error(
                `Sites detail returned domain "${String(site.domain)}"; expected "${options.site}".`,
            );
        }
        checks.push({
            name: "sites",
            status: "ok",
            detail: `verified site "${options.site}"`,
        });
    }

    // 3. Analytics Engine metrics (realtime). Exactly 3 finite metrics.
    {
        const body = await boundedFetch(
            fetchFn,
            `${origin}${QUERY_PATH}`,
            {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({
                    ...AE_QUERY_BODY,
                    site_id: options.site,
                }),
            },
            timeoutMs,
        );
        expectAggregateMetricsResult(body, "Metrics query", 3);
        checks.push({
            name: "metrics",
            status: "ok",
            detail: "visitors/pageviews/events (24h)",
        });
    }

    // 4. Exact session metric (R2 SQL), unless skipped. Exactly 1 finite metric.
    if (!options.skipDurable) {
        const body = await boundedFetch(
            fetchFn,
            `${origin}${QUERY_PATH}`,
            {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({
                    ...DURABLE_QUERY_BODY,
                    site_id: options.site,
                }),
            },
            timeoutMs,
        );
        expectAggregateMetricsResult(body, "Session query", 1);
        checks.push({
            name: "session",
            status: "ok",
            detail: "visits (R2 SQL, exact session metric)",
        });
    }

    return { checks };
}
