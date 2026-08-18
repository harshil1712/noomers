import { describe, it, expect, vi } from "vitest";
import { validateDeployment, validateDeploymentUrl } from "../validate.js";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
    return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "Content-Type": "application/json" },
    });
}

function healthOk(): Response {
    return new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
}

/** A fetch stub that records requests and returns a sequence of responses. */
function makeFetch(responses: Response[]) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = vi
        .fn()
        .mockImplementation(async (input: string, init?: RequestInit) => {
            calls.push({ url: input, init: init ?? {} });
            const next = responses.shift();
            if (!next) {
                throw new Error("Unexpected request");
            }
            return next;
        });
    return { fetchFn, calls };
}

const baseResponses = () => [
    healthOk(),
    jsonResponse({
        domain: "example.com",
        timezone: "Etc/UTC",
    }),
    jsonResponse({
        results: [{ dimensions: [], metrics: [1, 2, 3] }],
        query: {},
    }),
    jsonResponse({ results: [{ dimensions: [], metrics: [4] }], query: {} }),
];

const VALID_URL = "https://app.example.workers.dev";

describe("validateDeploymentUrl", () => {
    it("accepts an https URL and returns its origin", () => {
        expect(validateDeploymentUrl(VALID_URL)).toBe(VALID_URL);
    });

    it("accepts localhost and 127.0.0.1 over http", () => {
        expect(validateDeploymentUrl("http://localhost:8787")).toBe(
            "http://localhost:8787",
        );
        expect(validateDeploymentUrl("http://127.0.0.1:8787")).toBe(
            "http://127.0.0.1:8787",
        );
    });

    it("rejects a non-loopback http URL", () => {
        expect(() => validateDeploymentUrl("http://example.com")).toThrow(
            /HTTPS/,
        );
    });

    it("rejects URLs containing credentials", () => {
        expect(() =>
            validateDeploymentUrl("https://user:pass@example.com"),
        ).toThrow(/credentials/);
    });

    it("rejects URLs with a query string", () => {
        expect(() => validateDeploymentUrl("https://example.com?x=1")).toThrow(
            /query/,
        );
    });

    it("rejects URLs with a fragment", () => {
        expect(() => validateDeploymentUrl("https://example.com#frag")).toThrow(
            /fragment/,
        );
    });

    it("rejects URLs with a path", () => {
        expect(() => validateDeploymentUrl("https://example.com/path")).toThrow(
            /path/,
        );
    });

    it("rejects malformed URLs", () => {
        expect(() => validateDeploymentUrl("not a url")).toThrow(
            /valid deployment URL/,
        );
    });
});

describe("validateDeployment", () => {
    it("performs the exact read-only requests in order", async () => {
        const { fetchFn, calls } = makeFetch(baseResponses());

        const result = await validateDeployment({
            url: VALID_URL,
            site: "example.com",
            apiToken: "sekret",
            fetchFn,
        });

        expect(result.checks.map((c) => c.name)).toEqual([
            "health",
            "sites",
            "metrics",
            "session",
        ]);

        expect(calls.map((c) => c.url)).toEqual([
            `${VALID_URL}/api/health`,
            `${VALID_URL}/api/v1/sites/example.com`,
            `${VALID_URL}/api/v2/query`,
            `${VALID_URL}/api/v2/query`,
        ]);

        // GET requests
        expect(calls[0].init.method).toBe("GET");
        expect(calls[1].init.method).toBe("GET");
        // Query POSTs carry bearer auth and JSON bodies with the exact payloads.
        for (const call of calls.slice(2)) {
            expect(call.init.method).toBe("POST");
            const headers = call.init.headers as Record<string, string>;
            expect(headers.Authorization).toBe("Bearer sekret");
            expect(headers["Content-Type"]).toBe("application/json");
        }

        const aeBody = JSON.parse(calls[2].init.body as string);
        expect(aeBody).toEqual({
            site_id: "example.com",
            metrics: ["visitors", "pageviews", "events"],
            date_range: "24h",
        });
        const durableBody = JSON.parse(calls[3].init.body as string);
        expect(durableBody).toEqual({
            site_id: "example.com",
            metrics: ["visits"],
            date_range: "24h",
        });
    });

    it("skips the durable session check when skipDurable is true", async () => {
        const { fetchFn, calls } = makeFetch(baseResponses().slice(0, 3));

        const result = await validateDeployment({
            url: VALID_URL,
            site: "example.com",
            apiToken: "sekret",
            skipDurable: true,
            fetchFn,
        });

        expect(result.checks.map((c) => c.name)).toEqual([
            "health",
            "sites",
            "metrics",
        ]);
        expect(calls).toHaveLength(3);
        // Only one query POST (the Analytics Engine metrics check); the durable
        // session check is skipped.
        const queryPosts = calls.filter((c) => c.url.endsWith("/api/v2/query"));
        expect(queryPosts).toHaveLength(1);
    });

    it("does not POST, create sites, or mutate any endpoint", async () => {
        const { fetchFn, calls } = makeFetch(baseResponses());
        await validateDeployment({
            url: VALID_URL,
            site: "example.com",
            apiToken: "sekret",
            fetchFn,
        });
        // Only GET /api/health, GET /api/v1/sites/:site, and POST /api/v2/query
        // are touched. No create/delete/collect/event endpoints.
        const urls = calls.map((c) => c.url);
        expect(urls).toEqual([
            `${VALID_URL}/api/health`,
            `${VALID_URL}/api/v1/sites/example.com`,
            `${VALID_URL}/api/v2/query`,
            `${VALID_URL}/api/v2/query`,
        ]);
        expect(urls.some((u) => u.includes("/collect"))).toBe(false);
        expect(urls.some((u) => u.includes("/api/event"))).toBe(false);
        // The sites detail check is a GET, never a POST (no creation).
        const sitesCall = calls.find((c) => c.url.includes("/api/v1/sites/"));
        expect(sitesCall?.init.method).toBe("GET");
    });

    it("rejects an empty API token", async () => {
        const { fetchFn } = makeFetch([]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "",
                fetchFn,
            }),
        ).rejects.toThrow(/NOOMERS_API_TOKEN/);
    });

    it("fails when the site is missing (404 from the detail endpoint)", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ error: "Site not found" }, { status: 404 }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/HTTP 404/);
    });

    it("fails when the detail endpoint returns a different domain", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ domain: "other.com", timezone: "Etc/UTC" }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/expected "example\.com"/);
    });

    it("fails on a non-2xx health response", async () => {
        const { fetchFn } = makeFetch([new Response("ok", { status: 500 })]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/HTTP 500/);
    });

    it("fails on a non-JSON health body", async () => {
        const { fetchFn } = makeFetch([
            new Response("not-ok", { status: 200 }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/unexpected body/);
    });

    it("fails on a non-2xx Sites response (auth failure)", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ error: "Invalid API key" }, { status: 401 }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "wrong",
                fetchFn,
            }),
        ).rejects.toThrow(/HTTP 401/);
    });

    it("fails on a malformed sites detail response shape", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ domain: 123 }), // not a valid site object domain
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/expected "example\.com"/);
    });

    it("fails on a malformed metrics response shape", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ domain: "example.com" }),
            jsonResponse({ no_results: true }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/malformed response shape/);
    });

    it("fails when the metrics response has an empty metrics array", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ domain: "example.com" }),
            jsonResponse({ results: [{ dimensions: [], metrics: [] }] }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/0 metrics; expected exactly 3/);
    });

    it("fails when the metrics response has the wrong metric count", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ domain: "example.com" }),
            jsonResponse({
                results: [{ dimensions: [], metrics: [1, 2, 3, 4] }],
            }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/4 metrics; expected exactly 3/);
    });

    it("fails when the metrics response has non-empty dimensions", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ domain: "example.com" }),
            jsonResponse({
                results: [{ dimensions: ["/pricing"], metrics: [1, 2, 3] }],
            }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/malformed dimensions/);
    });

    it("fails when the metrics response has more than one result row", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ domain: "example.com" }),
            jsonResponse({
                results: [
                    { dimensions: [], metrics: [1, 2, 3] },
                    { dimensions: [], metrics: [4, 5, 6] },
                ],
            }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/2 result rows; expected exactly 1/);
    });

    it("fails when metrics values are not finite numbers", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ domain: "example.com" }),
            jsonResponse({
                results: [{ dimensions: [], metrics: ["x", 2, 3] }],
            }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/Metrics query metrics\[0\]/);
    });

    it("fails on a network error", async () => {
        const fetchFn = vi
            .fn()
            .mockRejectedValue(new TypeError("fetch failed"));
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/fetch failed/);
    });

    it("fails on a timeout via AbortError", async () => {
        const fetchFn = vi
            .fn()
            .mockRejectedValue(
                new DOMException("The operation was aborted", "AbortError"),
            );
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/timed out/);
    });

    it("fails when the durable session query returns a malformed shape", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ domain: "example.com" }),
            jsonResponse({ results: [{ dimensions: [], metrics: [1, 2, 3] }] }),
            jsonResponse({ broken: true }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/malformed response shape/);
    });

    it("fails when the durable session query returns no result rows", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ domain: "example.com" }),
            jsonResponse({ results: [{ dimensions: [], metrics: [1, 2, 3] }] }),
            jsonResponse({ results: [] }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/0 result rows; expected exactly 1/);
    });

    it("fails when the durable session query returns the wrong metric count", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ domain: "example.com" }),
            jsonResponse({ results: [{ dimensions: [], metrics: [1, 2, 3] }] }),
            jsonResponse({
                results: [{ dimensions: [], metrics: [1, 2] }],
            }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/2 metrics; expected exactly 1/);
    });

    it("fails when the durable session query has non-empty dimensions", async () => {
        const { fetchFn } = makeFetch([
            healthOk(),
            jsonResponse({ domain: "example.com" }),
            jsonResponse({ results: [{ dimensions: [], metrics: [1, 2, 3] }] }),
            jsonResponse({
                results: [{ dimensions: ["/pricing"], metrics: [1] }],
            }),
        ]);
        await expect(
            validateDeployment({
                url: VALID_URL,
                site: "example.com",
                apiToken: "sekret",
                fetchFn,
            }),
        ).rejects.toThrow(/malformed dimensions/);
    });

    it("rejects a non-positive or non-finite timeoutMs", async () => {
        const { fetchFn } = makeFetch(baseResponses());
        for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
            await expect(
                validateDeployment({
                    url: VALID_URL,
                    site: "example.com",
                    apiToken: "sekret",
                    timeoutMs: bad,
                    fetchFn,
                }),
            ).rejects.toThrow(/positive finite number/);
        }
    });

    it("applies the bounded timeout to each request", async () => {
        const { fetchFn, calls } = makeFetch(baseResponses());
        await validateDeployment({
            url: VALID_URL,
            site: "example.com",
            apiToken: "sekret",
            timeoutMs: 500,
            fetchFn,
        });
        for (const call of calls) {
            const signal = call.init.signal as AbortSignal;
            expect(signal.aborted).toBe(false);
            expect(signal).toBeDefined();
        }
    });
});
