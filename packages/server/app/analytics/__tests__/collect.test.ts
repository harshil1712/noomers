/*eslint @typescript-eslint/no-explicit-any: 0 */
import { Mock, describe, expect, test, vi, beforeEach } from "vitest";
import type { AnalyticsEngineDataset } from "@cloudflare/workers-types";
import httpMocks from "node-mocks-http";

import { collectRequestHandler as handleCollectRequest } from "../collect";

const activeSitesDatabase = {
    prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ status: "active" }),
    })),
} as unknown as D1Database;

function collectRequestHandler(
    request: Parameters<typeof handleCollectRequest>[0],
    env: Parameters<typeof handleCollectRequest>[1],
    extra?: Parameters<typeof handleCollectRequest>[2],
) {
    return handleCollectRequest(
        request,
        { GOALS_DB: activeSitesDatabase, ...env },
        extra,
    );
}

const defaultRequestParams = generateRequestParams({
    "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36",
});

function generateRequestParams(headers: Record<string, string>) {
    return {
        method: "GET",
        url:
            "https://example.com/user/42?" +
            new URLSearchParams({
                sid: "example",
                h: "example.com",
                p: "/post/123",
                r: "https://google.com",
                nv: "1",
                ns: "1",
                us: "google",
                um: "search",
                uc: "summer_sale",
                ut: "running_shoes",
                uco: "ad1",
            }).toString(),
        headers: {
            get: (_header: string) => {
                return headers[_header];
            },
        },
        // Cloudflare-specific request properties
        cf: {
            country: "US",
        },
    };
}

describe("collectRequestHandler", () => {
    test("rejects tombstoned sites before recording an event", async () => {
        const writeDataPoint = vi.fn();
        const statement = {
            bind: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ status: "deleted" }),
        };
        const env = {
            WEB_COUNTER_AE: { writeDataPoint } as AnalyticsEngineDataset,
            GOALS_DB: { prepare: vi.fn(() => statement) },
        } as unknown as Env;

        const response = await collectRequestHandler(
            defaultRequestParams as any,
            env,
        );

        expect(response.status).toBe(410);
        expect(await response.text()).toBe("Site deleted");
        expect(writeDataPoint).not.toHaveBeenCalled();
    });

    test.each([
        ["unprovisioned sites", { status: "unknown" }, 404],
        ["D1 failures", new Error("D1 unavailable"), 503],
    ])("rejects %s before recording an event", async (_, result, expectedStatus) => {
        const writeDataPoint = vi.fn();
        const first =
            result instanceof Error
                ? vi.fn().mockRejectedValue(result)
                : vi.fn().mockResolvedValue(result);
        const env = {
            WEB_COUNTER_AE: { writeDataPoint } as AnalyticsEngineDataset,
            GOALS_DB: {
                prepare: vi.fn(() => ({ bind: vi.fn().mockReturnThis(), first })),
            },
        } as unknown as Env;

        const response = await handleCollectRequest(
            defaultRequestParams as any,
            env,
        );

        expect(response.status).toBe(expectedStatus);
        expect(writeDataPoint).not.toHaveBeenCalled();
    });

    test("returns 503 when the site registry binding is missing", async () => {
        const writeDataPoint = vi.fn();
        const response = await handleCollectRequest(defaultRequestParams as any, {
            WEB_COUNTER_AE: { writeDataPoint } as AnalyticsEngineDataset,
        });

        expect(response.status).toBe(503);
        expect(writeDataPoint).not.toHaveBeenCalled();
    });

    test("returns 400 when siteId is missing", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;

        const request = generateRequestParams({
            "user-agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36",
        });
        request.url =
            "https://example.com/user/42?" +
            new URLSearchParams({
                h: "example.com",
                p: "/post/123",
                r: "https://google.com",
                nv: "1",
                ns: "1",
            }).toString();

        const response = await collectRequestHandler(request as any, env);
        expect(response.status).toBe(400);
        expect(env.WEB_COUNTER_AE.writeDataPoint).not.toHaveBeenCalled();
    });

    test("returns 400 when siteId is empty string", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;

        const request = generateRequestParams({
            "user-agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36",
        });
        request.url =
            "https://example.com/user/42?" +
            new URLSearchParams({
                sid: "",
                h: "example.com",
                p: "/post/123",
                r: "https://google.com",
                nv: "1",
                ns: "1",
            }).toString();

        const response = await collectRequestHandler(request as any, env);
        expect(response.status).toBe(400);
        expect(env.WEB_COUNTER_AE.writeDataPoint).not.toHaveBeenCalled();
    });

    beforeEach(() => {
        // default time is just middle of the day
        vi.setSystemTime(new Date("2024-01-18T09:33:02").getTime());
    });

    test("invokes writeDataPoint with transformed params", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;

        // @ts-expect-error - we're mocking the request object
        const request = httpMocks.createRequest(defaultRequestParams);

        await collectRequestHandler(request as any, env, {
            country: "US",
        });

        const writeDataPoint = env.WEB_COUNTER_AE.writeDataPoint;
        expect(env.WEB_COUNTER_AE.writeDataPoint).toHaveBeenCalled();

        // verify data shows up in the right place
        expect((writeDataPoint as Mock).mock.calls[0][0]).toEqual({
            blobs: [
                "example.com", // host
                "", // raw user agent is not persisted
                "/post/123", // url
                "US", // country
                "https://google.com", // referrer
                "Chrome", // browser name
                "",
                "example", // site id
                "51.x.x.x", // browser version
                "desktop", // device type
                "google", // utm_source
                "search", // utm_medium
                "summer_sale", // utm_campaign
                "running_shoes", // utm_term
                "ad1", // utm_content
                "", // custom event name
                "", // custom event properties
                "", // daily visitor id
            ],
            doubles: [
                1, // new visitor
                0, // DEAD COLUMN (was session)
                1, // new visit, so bounce
            ],
            indexes: [
                "example", // site id is index
            ],
        });
    });

    test("if-modified-since is absent", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;

        // @ts-expect-error - we're mocking the request object
        const request = httpMocks.createRequest(generateRequestParams({}));

        await collectRequestHandler(request as any, env);

        const writeDataPoint = env.WEB_COUNTER_AE.writeDataPoint;
        expect((writeDataPoint as Mock).mock.calls[0][0]).toHaveProperty(
            "doubles",
            [
                1, // new visitor
                0, // DEAD COLUMN (was session)
                1, // new visit, so bounce
            ],
        );
    });

    test("if-modified-since is within 30 minutes", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;

        const request = httpMocks.createRequest(
            // @ts-expect-error - we're mocking the request object
            generateRequestParams({
                "if-modified-since": new Date(
                    Date.now() - 5 * 60 * 1000, // 5 mins ago
                ).toUTCString(),
            }),
        );

        await collectRequestHandler(request as any, env);

        const writeDataPoint = env.WEB_COUNTER_AE.writeDataPoint;
        expect((writeDataPoint as Mock).mock.calls[0][0]).toHaveProperty(
            "doubles",
            [
                0, // NOT a new visitor
                0, // DEAD COLUMN (was session)
                0, // NOT first or second visit
            ],
        );
    });

    test("if-modified since is within 30 minutes but over day boundary", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;

        // intentionally set system time as 00:15:00
        // if the user last visited ~30 minutes ago, that occurred during
        // the prior day, so this should be considered a new visit
        vi.setSystemTime(new Date("2024-01-18T00:15:00").getTime());

        const request = httpMocks.createRequest(
            // @ts-expect-error - we're mocking the request object
            generateRequestParams({
                "if-modified-since": new Date(
                    Date.now() - 25 * 60 * 1000, // 25 minutes ago
                ).toUTCString(),
            }),
        );

        await collectRequestHandler(request as any, env);

        const writeDataPoint = env.WEB_COUNTER_AE.writeDataPoint;
        expect((writeDataPoint as Mock).mock.calls[0][0]).toHaveProperty(
            "doubles",
            [
                1, // new visitor because a new day began
                0, // DEAD COLUMN (was session)
                1, // new visitor so bounce counted
            ],
        );
    });

    test("if-modified-since is over 30 days ago", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;

        const request = httpMocks.createRequest(
            // @ts-expect-error - we're mocking the request object
            generateRequestParams({
                "if-modified-since": new Date(
                    Date.now() - 31 * 24 * 60 * 60 * 1000, // 31 days ago
                ).toUTCString(),
            }),
        );

        await collectRequestHandler(request as any, env);

        const writeDataPoint = env.WEB_COUNTER_AE.writeDataPoint;
        expect((writeDataPoint as Mock).mock.calls[0][0]).toHaveProperty(
            "doubles",
            [
                1, // new visitor because > 30 days passed
                0, // DEAD COLUMN (was session)
                1, // new visitor so bounce
            ],
        );
    });

    test("if-modified-since was yesterday", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;

        const request = httpMocks.createRequest(
            // @ts-expect-error - we're mocking the request object
            generateRequestParams({
                "if-modified-since": new Date(
                    Date.now() - 24 * 60 * 60 * 1000, // 24 hours ago
                ).toUTCString(),
            }),
        );

        await collectRequestHandler(request as any, env);

        const writeDataPoint = env.WEB_COUNTER_AE.writeDataPoint;
        expect((writeDataPoint as Mock).mock.calls[0][0]).toHaveProperty(
            "doubles",
            [
                1, // new visitor because > 24 hours passed
                0, // DEAD COLUMN (was session)
                1, // new visitor so bounce
            ],
        );
    });

    test("if-modified-since is one second after midnight", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;

        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);

        vi.setSystemTime(midnight.getTime());

        const midnightPlusOneSecond = new Date(midnight.getTime());
        midnightPlusOneSecond.setSeconds(
            midnightPlusOneSecond.getSeconds() + 1,
        );

        const request = httpMocks.createRequest(
            // @ts-expect-error - we're mocking the request object
            generateRequestParams({
                "if-modified-since": midnightPlusOneSecond.toUTCString(),
            }),
        );

        await collectRequestHandler(request as any, env);

        const writeDataPoint = env.WEB_COUNTER_AE.writeDataPoint;
        expect((writeDataPoint as Mock).mock.calls[0][0]).toHaveProperty(
            "doubles",
            [
                0, // NOT a new visitor
                0, // DEAD COLUMN (was session)
                -1, // First visit after the initial visit so decrement bounce
            ],
        );
    });

    test("if-modified-since is two seconds after midnight", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;

        const midnightPlusOneSecond = new Date();
        midnightPlusOneSecond.setHours(0, 0, 1, 0);

        vi.setSystemTime(midnightPlusOneSecond.getTime());

        const midnightPlusTwoSeconds = new Date(
            midnightPlusOneSecond.getTime(),
        );
        midnightPlusTwoSeconds.setSeconds(
            midnightPlusTwoSeconds.getSeconds() + 1,
        );

        const request = httpMocks.createRequest(
            // @ts-expect-error - we're mocking the request object
            generateRequestParams({
                "if-modified-since": midnightPlusTwoSeconds.toUTCString(),
            }),
        );

        await collectRequestHandler(request as any, env);

        const writeDataPoint = env.WEB_COUNTER_AE.writeDataPoint;
        expect((writeDataPoint as Mock).mock.calls[0][0]).toHaveProperty(
            "doubles",
            [
                0, // NOT a new visitor
                0, // DEAD COLUMN (was session)
                0, // After the second visit so no bounce
            ],
        );
    });

    test("handles UTM parameters correctly", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;

        const request = generateRequestParams({
            "user-agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36",
        });

        await collectRequestHandler(request as any, env, {
            country: "US",
        });

        const writeDataPoint = env.WEB_COUNTER_AE.writeDataPoint;
        expect(env.WEB_COUNTER_AE.writeDataPoint).toHaveBeenCalled();

        const blobs = (writeDataPoint as Mock).mock.calls[0][0].blobs;
        expect(blobs[10]).toBe("google"); // utm_source
        expect(blobs[11]).toBe("search"); // utm_medium
        expect(blobs[12]).toBe("summer_sale"); // utm_campaign
        expect(blobs[13]).toBe("running_shoes"); // utm_term
        expect(blobs[14]).toBe("ad1"); // utm_content
    });

    test("handles missing UTM parameters gracefully", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;

        const request = generateRequestParams({
            "user-agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36",
        });
        // Remove UTM parameters from URL
        request.url = request.url
            .replace(/&us=[^&]*/, "")
            .replace(/&um=[^&]*/, "")
            .replace(/&uc=[^&]*/, "")
            .replace(/&ut=[^&]*/, "")
            .replace(/&uco=[^&]*/, "");

        await collectRequestHandler(request as any, env, {
            country: "US",
        });

        const writeDataPoint = env.WEB_COUNTER_AE.writeDataPoint;
        expect(env.WEB_COUNTER_AE.writeDataPoint).toHaveBeenCalled();

        const blobs = (writeDataPoint as Mock).mock.calls[0][0].blobs;
        expect(blobs[10]).toBe(""); // utm_source (empty)
        expect(blobs[11]).toBe(""); // utm_medium (empty)
        expect(blobs[12]).toBe(""); // utm_campaign (empty)
        expect(blobs[13]).toBe(""); // utm_term (empty)
        expect(blobs[14]).toBe(""); // utm_content (empty)
    });

    test("stores custom events without affecting visit or bounce counts", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;
        const request = generateRequestParams({});
        const url = new URL(request.url);
        url.searchParams.set("en", "Signup");
        url.searchParams.set(
            "ep",
            JSON.stringify({ plan: "pro", seats: 3, trial: true }),
        );
        request.url = url.toString();

        await collectRequestHandler(request as any, env);

        const datapoint = (env.WEB_COUNTER_AE.writeDataPoint as Mock).mock
            .calls[0][0];
        expect(datapoint.blobs[15]).toBe("Signup");
        expect(datapoint.blobs[16]).toBe(
            JSON.stringify({ plan: "pro", seats: 3, trial: true }),
        );
        expect(datapoint.doubles).toEqual([0, 0, 0]);
    });

    test("stores a stable salted daily visitor id without storing the IP", async () => {
        const writeDataPoint = vi.fn();
        const env = {
            WEB_COUNTER_AE: { writeDataPoint } as AnalyticsEngineDataset,
            VISITOR_SALT: "test-secret",
        } as Env;
        const request = new Request(
            "https://example.com/collect?sid=example&h=example.com&p=/&r=",
            {
                headers: {
                    "cf-connecting-ip": "203.0.113.10",
                    "user-agent": "Test Browser",
                },
            },
        );

        await collectRequestHandler(request, env);
        await collectRequestHandler(request, env);

        const firstBlobs = writeDataPoint.mock.calls[0][0].blobs;
        const secondBlobs = writeDataPoint.mock.calls[1][0].blobs;
        expect(firstBlobs[17]).toMatch(/^[0-9a-f]{64}$/);
        expect(secondBlobs[17]).toBe(firstBlobs[17]);
        expect(firstBlobs).not.toContain("203.0.113.10");
    });

    test("sends a privacy-safe canonical event to the durable stream", async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        const env = {
            WEB_COUNTER_AE: { writeDataPoint: vi.fn() } as AnalyticsEngineDataset,
            EVENT_STREAM: { send },
            VISITOR_SALT: "test-secret",
        };
        const request = new Request("https://example.com/collect", {
            method: "POST",
            headers: {
                "cf-connecting-ip": "203.0.113.10",
                "user-agent": "Mozilla/5.0 Chrome/120.0.0.0",
            },
            body: new URLSearchParams({
                sid: "example",
                h: "example.com",
                p: "/signup",
                r: "https://search.example/",
                en: "Signup",
                ep: JSON.stringify({ plan: "pro" }),
                us: "newsletter",
            }),
        });

        const response = await collectRequestHandler(request, env, {
            country: "US",
        });

        expect(response.status).toBe(200);
        expect(send).toHaveBeenCalledWith([
            expect.objectContaining({
                schema_version: 2,
                event_id: expect.any(String),
                received_at: new Date().toISOString(),
                site_id: "example",
                event_type: "custom",
                event_name: "Signup",
                event_properties: JSON.stringify({ plan: "pro" }),
                hostname: "example.com",
                pathname: "/signup",
                referrer: "https://search.example/",
                country: "US",
                utm_source: "newsletter",
                visitor_id: expect.stringMatching(/^[0-9a-f]{64}$/),
            }),
        ]);
        const durableEvent = send.mock.calls[0][0][0];
        expect(Object.values(durableEvent)).not.toContain("203.0.113.10");
        expect(Object.values(durableEvent)).not.toContain(
            "Mozilla/5.0 Chrome/120.0.0.0",
        );
    });

    test("keeps collecting when durable event ingestion fails", async () => {
        const writeDataPoint = vi.fn();
        const send = vi.fn().mockRejectedValue(new Error("stream unavailable"));
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const env = {
            WEB_COUNTER_AE: { writeDataPoint } as AnalyticsEngineDataset,
            EVENT_STREAM: { send },
        };
        const request = new Request(
            "https://example.com/collect?sid=example&h=example.com&p=/",
        );

        const response = await collectRequestHandler(request, env);

        expect(response.status).toBe(200);
        expect(writeDataPoint).toHaveBeenCalledOnce();
        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining("durable event ingestion failed"),
        );
        consoleError.mockRestore();
    });

    test("accepts a server-supplied IP in a POST body without persisting it", async () => {
        const writeDataPoint = vi.fn();
        const env = {
            WEB_COUNTER_AE: { writeDataPoint } as AnalyticsEngineDataset,
            VISITOR_SALT: "test-secret",
        } as Env;
        const request = new Request("https://example.com/collect", {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                "user-agent": "Visitor Browser",
            },
            body: new URLSearchParams({
                sid: "example",
                h: "example.com",
                p: "/signup",
                r: "",
                en: "Signup",
                ip: "203.0.113.10",
            }),
        });

        await collectRequestHandler(request, env);

        const blobs = writeDataPoint.mock.calls[0][0].blobs;
        expect(blobs[17]).toMatch(/^[0-9a-f]{64}$/);
        expect(blobs).not.toContain("203.0.113.10");
    });

    test("rejects oversized POST bodies before collecting analytics", async () => {
        const writeDataPoint = vi.fn();
        const env = {
            WEB_COUNTER_AE: { writeDataPoint } as AnalyticsEngineDataset,
        } as Env;
        const request = new Request("https://example.com/collect", {
            method: "POST",
            body: `sid=example&payload=${"x".repeat(32 * 1024)}`,
        });

        const response = await collectRequestHandler(request, env);

        expect(response.status).toBe(413);
        expect(writeDataPoint).not.toHaveBeenCalled();
    });

    test("accepts valid Unicode event properties after form encoding", async () => {
        const writeDataPoint = vi.fn();
        const env = {
            WEB_COUNTER_AE: { writeDataPoint } as AnalyticsEngineDataset,
        } as Env;
        const properties = JSON.stringify({ label: "é".repeat(1000) });
        const request = new Request("https://example.com/collect", {
            method: "POST",
            body: new URLSearchParams({
                sid: "example",
                h: "example.com",
                p: "/signup",
                r: "",
                en: "Signup",
                ep: properties,
            }),
        });

        const response = await collectRequestHandler(request, env);

        expect(response.status).toBe(200);
        expect(writeDataPoint.mock.calls[0][0].blobs[16]).toBe(properties);
    });

    test("accepts POST collector parameters from the query string", async () => {
        const writeDataPoint = vi.fn();
        const env = {
            WEB_COUNTER_AE: { writeDataPoint } as AnalyticsEngineDataset,
        };
        const request = new Request(
            "https://example.com/collect?sid=example&h=example.com&p=/query",
            { method: "POST", body: "" },
        );

        const response = await collectRequestHandler(request, env);

        expect(response.status).toBe(200);
        expect(writeDataPoint.mock.calls[0][0].blobs[2]).toBe("/query");
    });

    test("rejects invalid custom event properties", async () => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;
        const request = generateRequestParams({});
        const url = new URL(request.url);
        url.searchParams.set("en", "Signup");
        url.searchParams.set("ep", JSON.stringify({ nested: { value: 1 } }));
        request.url = url.toString();

        const response = await collectRequestHandler(request as any, env);

        expect(response.status).toBe(400);
        expect(env.WEB_COUNTER_AE.writeDataPoint).not.toHaveBeenCalled();
    });

    test.each([
        ["an empty event name", { en: "" }],
        ["properties without an event name", { ep: '{"plan":"pro"}' }],
    ])("rejects %s", async (_, eventParams) => {
        const env = {
            WEB_COUNTER_AE: {
                writeDataPoint: vi.fn(),
            } as AnalyticsEngineDataset,
        } as Env;
        const request = generateRequestParams({});
        const url = new URL(request.url);
        Object.entries(eventParams).forEach(([key, value]) =>
            url.searchParams.set(key, value),
        );
        request.url = url.toString();

        const response = await collectRequestHandler(request as any, env);

        expect(response.status).toBe(400);
        expect(env.WEB_COUNTER_AE.writeDataPoint).not.toHaveBeenCalled();
    });

    test("logs a privacy-safe warning when Analytics Engine is unavailable", async () => {
        const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const env = {
            WEB_COUNTER_AE: undefined,
            VISITOR_SALT: "test-secret",
        } as unknown as Env;
        const request = new Request("https://example.com/collect", {
            method: "POST",
            headers: {
                "cf-connecting-ip": "203.0.113.10",
                "user-agent": "Mozilla/5.0 Chrome/120.0.0.0",
            },
            body: new URLSearchParams({
                sid: "example",
                h: "example.com",
                p: "/private/page",
                r: "https://referrer.example/",
                en: "Signup",
                ep: JSON.stringify({ plan: "pro", email: "user@example.com" }),
                us: "newsletter",
            }),
        });

        const response = await collectRequestHandler(request, env, {
            country: "US",
        });

        expect(response.status).toBe(200);
        expect(consoleWarn).toHaveBeenCalledTimes(1);
        const warning = consoleWarn.mock.calls[0][0] as string;
        expect(warning).toContain("realtime analytics unavailable");
        for (const sensitive of [
            "example",
            "example.com",
            "/private/page",
            "https://referrer.example/",
            "Signup",
            "pro",
            "user@example.com",
            "newsletter",
            "203.0.113.10",
        ]) {
            expect(warning).not.toContain(sensitive);
        }
        consoleWarn.mockRestore();
    });
});
