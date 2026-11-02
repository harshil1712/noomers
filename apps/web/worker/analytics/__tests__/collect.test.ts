/*eslint @typescript-eslint/no-explicit-any: 0 */
import { Mock, describe, expect, test, vi, beforeEach } from "vitest";
import httpMocks from "node-mocks-http";

import { collectRequestHandler as handleCollectRequest } from "../collect";
import { createSiteEventsStub } from "../../__testutils__/site-events";

const { stub: siteEventsStub, namespace: siteEventsNamespace } =
    createSiteEventsStub();

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
        { DB: activeSitesDatabase, ...env },
        extra,
    );
}

const defaultBrowserUserAgent =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36";

const defaultRequestParams = generateRequestParams({
    "user-agent": defaultBrowserUserAgent,
});

function generateRequestParams(headers: Record<string, string>) {
    const mergedHeaders: Record<string, string> = {
        "user-agent": defaultBrowserUserAgent,
        ...headers,
    };
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
                return mergedHeaders[_header];
            },
        },
        // Cloudflare-specific request properties
        cf: {
            country: "US",
        },
    };
}

describe("collectRequestHandler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        siteEventsStub.record.mockClear();
    });
    test("rejects tombstoned sites before recording an event", async () => {
                const statement = {
            bind: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ status: "deleted" }),
        };
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",            DB: { prepare: vi.fn(() => statement) },
        } as unknown as Env;

        const response = await collectRequestHandler(
            defaultRequestParams as any,
            env,
        );

        expect(response.status).toBe(410);
        expect(await response.text()).toBe("Site deleted");
        expect(siteEventsStub.record).not.toHaveBeenCalled();
    });

    test.each([
        ["unprovisioned sites", { status: "unknown" }, 404],
        ["D1 failures", new Error("D1 unavailable"), 503],
    ])(
        "rejects %s before recording an event",
        async (_, result, expectedStatus) => {
                        const first =
                result instanceof Error
                    ? vi.fn().mockRejectedValue(result)
                    : vi.fn().mockResolvedValue(result);
            const env = {
                SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",                DB: {
                    prepare: vi.fn(() => ({
                        bind: vi.fn().mockReturnThis(),
                        first,
                    })),
                },
            } as unknown as Env;

            const response = await handleCollectRequest(
                defaultRequestParams as any,
                env,
            );

            expect(response.status).toBe(expectedStatus);
            expect(siteEventsStub.record).not.toHaveBeenCalled();
        },
    );

    test("returns 503 when the site registry binding is missing", async () => {
                const response = await handleCollectRequest(
            defaultRequestParams as any,
            {
                SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        },
        );

        expect(response.status).toBe(503);
        expect(siteEventsStub.record).not.toHaveBeenCalled();
    });

    test("returns 400 when siteId is missing", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;

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

        const response = await collectRequestHandler(request as any, env as Env);
        expect(response.status).toBe(400);
        expect(siteEventsStub.record).not.toHaveBeenCalled();
    });

    test("returns 400 when siteId is empty string", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;

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

        const response = await collectRequestHandler(request as any, env as Env);
        expect(response.status).toBe(400);
        expect(siteEventsStub.record).not.toHaveBeenCalled();
    });

    beforeEach(() => {
        // default time is just middle of the day
        vi.setSystemTime(new Date("2024-01-18T09:33:02").getTime());
    });

    test("invokes siteEventsStub.record with transformed params", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;

        // @ts-expect-error - we're mocking the request object
        const request = httpMocks.createRequest(defaultRequestParams);

        await collectRequestHandler(request as any, env as Env, {
            country: "US",
        });

        expect(siteEventsStub.record).toHaveBeenCalled();

        // verify data shows up in the right place
        expect(
            (siteEventsStub.record as Mock).mock.calls[0][0],
        ).toMatchObject({
            schema_version: 2,
            site_id: "example",
            event_type: "pageview",
            event_name: "pageview",
            hostname: "example.com",
            pathname: "/post/123",
            referrer: "https://google.com",
            country: "US",
            browser: "Chrome",
            browser_version: "51.x.x.x",
            device_type: "desktop",
            utm_source: "google",
            utm_medium: "search",
            utm_campaign: "summer_sale",
            utm_term: "running_shoes",
            utm_content: "ad1",
            visitor_id: "",
        });
    });

    test("if-modified-since is absent", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;

        // @ts-expect-error - we're mocking the request object
        const request = httpMocks.createRequest(generateRequestParams({}));

        await collectRequestHandler(request as any, env as Env);

        expect(siteEventsStub.record).toHaveBeenCalled();
    });

    test("if-modified-since is within 30 minutes", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;

        const request = httpMocks.createRequest(
            // @ts-expect-error - we're mocking the request object
            generateRequestParams({
                "if-modified-since": new Date(
                    Date.now() - 5 * 60 * 1000, // 5 mins ago
                ).toUTCString(),
            }),
        );

        await collectRequestHandler(request as any, env as Env);

        expect(siteEventsStub.record).toHaveBeenCalled();
    });

    test("if-modified since is within 30 minutes but over day boundary", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;

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

        await collectRequestHandler(request as any, env as Env);

        expect(siteEventsStub.record).toHaveBeenCalled();
    });

    test("if-modified-since is over 30 days ago", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;

        const request = httpMocks.createRequest(
            // @ts-expect-error - we're mocking the request object
            generateRequestParams({
                "if-modified-since": new Date(
                    Date.now() - 31 * 24 * 60 * 60 * 1000, // 31 days ago
                ).toUTCString(),
            }),
        );

        await collectRequestHandler(request as any, env as Env);

        expect(siteEventsStub.record).toHaveBeenCalled();
    });

    test("if-modified-since was yesterday", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;

        const request = httpMocks.createRequest(
            // @ts-expect-error - we're mocking the request object
            generateRequestParams({
                "if-modified-since": new Date(
                    Date.now() - 24 * 60 * 60 * 1000, // 24 hours ago
                ).toUTCString(),
            }),
        );

        await collectRequestHandler(request as any, env as Env);

        expect(siteEventsStub.record).toHaveBeenCalled();
    });

    test("if-modified-since is one second after midnight", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;

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

        await collectRequestHandler(request as any, env as Env);

        expect(siteEventsStub.record).toHaveBeenCalled();
    });

    test("if-modified-since is two seconds after midnight", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;

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

        await collectRequestHandler(request as any, env as Env);

        expect(siteEventsStub.record).toHaveBeenCalled();
    });

    test("handles UTM parameters correctly", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;

        const request = generateRequestParams({
            "user-agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36",
        });

        await collectRequestHandler(request as any, env as Env, {
            country: "US",
        });

        expect(siteEventsStub.record).toHaveBeenCalled();

        const ev = (siteEventsStub.record as Mock).mock.calls[0][0];
        expect(ev.utm_source).toBe("google"); // utm_source
        expect(ev.utm_medium).toBe("search"); // utm_medium
        expect(ev.utm_campaign).toBe("summer_sale"); // utm_campaign
        expect(ev.utm_term).toBe("running_shoes"); // utm_term
        expect(ev.utm_content).toBe("ad1"); // utm_content
    });

    test("handles missing UTM parameters gracefully", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;

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

        await collectRequestHandler(request as any, env as Env, {
            country: "US",
        });

        expect(siteEventsStub.record).toHaveBeenCalled();

        const ev = (siteEventsStub.record as Mock).mock.calls[0][0];
        expect(ev.utm_source).toBe(""); // utm_source (empty)
        expect(ev.utm_medium).toBe(""); // utm_medium (empty)
        expect(ev.utm_campaign).toBe(""); // utm_campaign (empty)
        expect(ev.utm_term).toBe(""); // utm_term (empty)
        expect(ev.utm_content).toBe(""); // utm_content (empty)
    });

    test("stores custom events without affecting visit or bounce counts", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;
        const request = generateRequestParams({});
        const url = new URL(request.url);
        url.searchParams.set("en", "Signup");
        url.searchParams.set(
            "ep",
            JSON.stringify({ plan: "pro", seats: 3, trial: true }),
        );
        request.url = url.toString();

        await collectRequestHandler(request as any, env as Env);

        const datapoint = (siteEventsStub.record as Mock).mock
            .calls[0][0];
        expect(datapoint.event_name).toBe("Signup");
        expect(datapoint.event_properties).toBe(
            JSON.stringify({ plan: "pro", seats: 3, trial: true }),
        );
        expect(siteEventsStub.record).toHaveBeenCalled();
    });

    test("stores a stable salted daily visitor id without storing the IP", async () => {
                const env = {
            SITE_EVENTS: siteEventsNamespace,
            VISITOR_SALT: "test-salt",
            SERVER_EVENTS_TOKEN: "s3cr3t",
        } as unknown as Env;
        const request = new Request(
            "https://example.com/collect?sid=example&h=example.com&p=/&r=",
            {
                headers: {
                    "cf-connecting-ip": "203.0.113.10",
                    "user-agent": defaultBrowserUserAgent,
                },
            },
        );

        await collectRequestHandler(request, env as Env);
        await collectRequestHandler(request, env as Env);

        const first = siteEventsStub.record.mock.calls[0][0];
        const second = siteEventsStub.record.mock.calls[1][0];
        expect(first.visitor_id).toMatch(/^[0-9a-f]{64}$/);
        expect(second.visitor_id).toBe(first.visitor_id);
        expect(Object.values(first)).not.toContain("203.0.113.10");
    });

    test("sends a privacy-safe canonical event to the durable stream", async () => {
        const send = siteEventsStub.record;
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
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

        const response = await collectRequestHandler(request, env as Env, {
            country: "US",
        });

        expect(response.status).toBe(200);
        expect(send).toHaveBeenCalledWith(
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
        );
        const durableEvent = send.mock.calls[0][0];
        expect(Object.values(durableEvent)).not.toContain("203.0.113.10");
        expect(Object.values(durableEvent)).not.toContain(
            "Mozilla/5.0 Chrome/120.0.0.0",
        );
    });

    test("returns 500 when event recording fails", async () => {
        siteEventsStub.record.mockRejectedValueOnce(
            new Error("stream unavailable"),
        );
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        };
        const request = new Request(
            "https://example.com/collect?sid=example&h=example.com&p=/",
            {
                headers: { "user-agent": defaultBrowserUserAgent },
            },
        );

        const response = await collectRequestHandler(request, env as Env);

        expect(response.status).toBe(500);
        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining("event recording failed"),
        );
        consoleError.mockRestore();
    });

    test("accepts a server-supplied IP in a POST body without persisting it", async () => {
                const env = {
            SITE_EVENTS: siteEventsNamespace,
            VISITOR_SALT: "test-salt",
            SERVER_EVENTS_TOKEN: "s3cr3t",
        } as unknown as Env;
        const request = new Request("https://example.com/collect", {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                "user-agent": defaultBrowserUserAgent,
                authorization: "Bearer s3cr3t",
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

        await collectRequestHandler(request, env as Env);

        const ev = siteEventsStub.record.mock.calls[0][0];
        expect(ev.visitor_id).toMatch(/^[0-9a-f]{64}$/);
        expect(Object.values(ev)).not.toContain("203.0.113.10");
    });

    test("rejects oversized POST bodies before collecting analytics", async () => {
                const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;
        const request = new Request("https://example.com/collect", {
            method: "POST",
            body: `sid=example&payload=${"x".repeat(32 * 1024)}`,
        });

        const response = await collectRequestHandler(request, env as Env);

        expect(response.status).toBe(413);
        expect(siteEventsStub.record).not.toHaveBeenCalled();
    });

    test("accepts valid Unicode event properties after form encoding", async () => {
                const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;
        const properties = JSON.stringify({ label: "é".repeat(1000) });
        const request = new Request("https://example.com/collect", {
            method: "POST",
            headers: { "user-agent": defaultBrowserUserAgent },
            body: new URLSearchParams({
                sid: "example",
                h: "example.com",
                p: "/signup",
                r: "",
                en: "Signup",
                ep: properties,
            }),
        });

        const response = await collectRequestHandler(request, env as Env);

        expect(response.status).toBe(200);
        expect(siteEventsStub.record.mock.calls[0][0].event_properties).toBe(properties);
    });

    test("accepts POST collector parameters from the query string", async () => {
                const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        };
        const request = new Request(
            "https://example.com/collect?sid=example&h=example.com&p=/query",
            {
                method: "POST",
                headers: { "user-agent": defaultBrowserUserAgent },
                body: "",
            },
        );

        const response = await collectRequestHandler(request, env as Env);

        expect(response.status).toBe(200);
        expect(siteEventsStub.record.mock.calls[0][0].pathname).toBe("/query");
    });

    test("rejects invalid custom event properties", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;
        const request = generateRequestParams({});
        const url = new URL(request.url);
        url.searchParams.set("en", "Signup");
        url.searchParams.set("ep", JSON.stringify({ nested: { value: 1 } }));
        request.url = url.toString();

        const response = await collectRequestHandler(request as any, env as Env);

        expect(response.status).toBe(400);
        expect(siteEventsStub.record).not.toHaveBeenCalled();
    });

    test.each([
        ["an empty event name", { en: "" }],
        ["properties without an event name", { ep: '{"plan":"pro"}' }],
    ])("rejects %s", async (_, eventParams) => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        } as unknown as Env;
        const request = generateRequestParams({});
        const url = new URL(request.url);
        Object.entries(eventParams).forEach(([key, value]) =>
            url.searchParams.set(key, value),
        );
        request.url = url.toString();

        const response = await collectRequestHandler(request as any, env as Env);

        expect(response.status).toBe(400);
        expect(siteEventsStub.record).not.toHaveBeenCalled();
    });

    test("returns 500 without leaking payloads when SITE_EVENTS is unavailable", async () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const env = {
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

        const response = await collectRequestHandler(request, env as Env, {
            country: "US",
        });

        expect(response.status).toBe(500);
        const logged = consoleError.mock.calls[0]?.[0] as string;
        for (const sensitive of [
            "/private/page",
            "https://referrer.example/",
            "Signup",
            "pro",
            "user@example.com",
            "newsletter",
            "203.0.113.10",
        ]) {
            expect(logged).not.toContain(sensitive);
        }
        consoleError.mockRestore();
    });

    test("drops bot traffic without writing to Analytics Engine or the durable stream", async () => {
                const send = siteEventsStub.record;
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        };
        const request = new Request(
            "https://example.com/collect?sid=example&h=example.com&p=/",
            {
                headers: {
                    "cf-connecting-ip": "203.0.113.10",
                    "user-agent": "agent-browser",
                },
            },
        );

        const response = await collectRequestHandler(request, env as Env);

        expect(response.status).toBe(200);
        expect(response.headers.get("x-noomers-dropped")).toBe("1");
        expect(response.headers.get("Content-Type")).toBe("image/gif");
        expect(response.headers.get("Last-Modified")).toBeNull();
        expect(siteEventsStub.record).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    test("records first-party server tracker traffic even though isbot flags its UA", async () => {
                const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        };
        const request = new Request(
            "https://example.com/collect?sid=example&h=example.com&p=/",
            {
                headers: {
                    "cf-connecting-ip": "203.0.113.10",
                    "user-agent": "noomers-tracker-server/3.4.1",
                },
            },
        );

        const response = await collectRequestHandler(request, env as Env);

        expect(response.status).toBe(200);
        expect(response.headers.get("x-noomers-dropped")).toBeNull();
        expect(siteEventsStub.record).toHaveBeenCalled();
    });

    test("drops a custom server user agent that isbot flags as a bot", async () => {
                const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        };
        const request = new Request(
            "https://example.com/collect?sid=example&h=example.com&p=/",
            {
                headers: {
                    "user-agent": "custom-server-lib/2.0",
                },
            },
        );

        const response = await collectRequestHandler(request, env as Env);

        expect(response.status).toBe(200);
        expect(response.headers.get("x-noomers-dropped")).toBe("1");
        expect(siteEventsStub.record).not.toHaveBeenCalled();
    });

    test("stores engagement events only to the durable stream", async () => {
                const send = siteEventsStub.record;
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        };
        const request = new Request("https://example.com/collect", {
            method: "POST",
            headers: { "user-agent": defaultBrowserUserAgent },
            body: new URLSearchParams({
                sid: "example",
                h: "example.com",
                p: "/article",
                r: "",
                et: "engagement",
                e: "5000",
                sd: "75",
            }),
        });

        const response = await collectRequestHandler(request, env as Env);

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("image/gif");
        expect(response.headers.get("Last-Modified")).toBeNull();
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                event_type: "engagement",
                event_name: "engagement",
                engagement_time: 5000,
                scroll_depth: 75,
                pathname: "/article",
                hostname: "example.com",
                interactive: false,
            }),
        );
        const durableEvent = send.mock.calls[0][0];
        expect(durableEvent.interactive).toBe(false);
    });

    test("engagement events record as engagement only", async () => {
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        };
        const request = new Request("https://example.com/collect", {
            method: "POST",
            headers: { "user-agent": defaultBrowserUserAgent },
            body: new URLSearchParams({
                sid: "example",
                h: "example.com",
                p: "/article",
                r: "",
                et: "engagement",
                e: "5000",
            }),
        });

        await collectRequestHandler(request, env as Env);

        expect(siteEventsStub.record).toHaveBeenCalledTimes(1);
        expect(siteEventsStub.record.mock.calls[0][0]).toMatchObject({
            event_type: "engagement",
            interactive: false,
        });
    });

    test("keeps a custom event named engagement as a custom event", async () => {
                const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        };
        const request = new Request("https://example.com/collect", {
            method: "POST",
            headers: { "user-agent": defaultBrowserUserAgent },
            body: new URLSearchParams({
                sid: "example",
                h: "example.com",
                p: "/",
                r: "",
                en: "engagement",
            }),
        });

        const response = await collectRequestHandler(request, env as Env);

        expect(response.status).toBe(200);
        expect(siteEventsStub.record).toHaveBeenCalled();
        expect(siteEventsStub.record.mock.calls[0][0].event_name).toBe("engagement");
    });

    test("accepts scroll-only engagement with e=0 and sd 1..100", async () => {
        const send = siteEventsStub.record;
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        };
        const request = new Request("https://example.com/collect", {
            method: "POST",
            headers: { "user-agent": defaultBrowserUserAgent },
            body: new URLSearchParams({
                sid: "example",
                h: "example.com",
                p: "/article",
                r: "",
                et: "engagement",
                e: "0",
                sd: "50",
            }),
        });

        const response = await collectRequestHandler(request, env as Env);

        expect(response.status).toBe(200);
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                event_type: "engagement",
                engagement_time: 0,
                scroll_depth: 50,
                interactive: false,
            }),
        );
    });

    test("accepts sd=0 when paired with a positive engagement time", async () => {
        const send = siteEventsStub.record;
        const env = {
            SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        };
        const request = new Request("https://example.com/collect", {
            method: "POST",
            headers: { "user-agent": defaultBrowserUserAgent },
            body: new URLSearchParams({
                sid: "example",
                h: "example.com",
                p: "/article",
                r: "",
                et: "engagement",
                e: "1000",
                sd: "0",
            }),
        });

        const response = await collectRequestHandler(request, env as Env);

        expect(response.status).toBe(200);
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                engagement_time: 1000,
                scroll_depth: 0,
            }),
        );
    });

    test.each([
        ["e=1000", "1000", undefined],
        ["e=max", String(30 * 24 * 60 * 60 * 1000), undefined],
        ["sd=100 with e=0", "0", "100"],
        ["sd=1 with e=0", "0", "1"],
    ])(
        "accepts engagement with %s",
        async (_, engagementTime, scrollDepth) => {
            const send = siteEventsStub.record;
            const env = {
                SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        };
            const params: Record<string, string> = {
                sid: "example",
                h: "example.com",
                p: "/article",
                r: "",
                et: "engagement",
                e: engagementTime,
            };
            if (scrollDepth !== undefined) {
                params.sd = scrollDepth;
            }
            const request = new Request("https://example.com/collect", {
                method: "POST",
                headers: { "user-agent": defaultBrowserUserAgent },
                body: new URLSearchParams(params),
            });

            const response = await collectRequestHandler(request, env as Env);

            expect(response.status).toBe(200);
            expect(send).toHaveBeenCalled();
        },
    );

    test.each([
        ["missing e", { et: "engagement" }],
        ["e below minimum", { et: "engagement", e: "500" }],
        ["e above maximum", { et: "engagement", e: "99999999999" }],
        ["non-integer e", { et: "engagement", e: "1500.5" }],
        ["hex e", { et: "engagement", e: "0x3e8", sd: "50" }],
        ["scientific e", { et: "engagement", e: "1e3", sd: "50" }],
        ["signed e", { et: "engagement", e: "-1000", sd: "50" }],
        ["whitespace e", { et: "engagement", e: " 1000", sd: "50" }],
        ["empty e", { et: "engagement", e: "", sd: "50" }],
        ["invalid sd", { et: "engagement", e: "5000", sd: "150" }],
        ["hex sd", { et: "engagement", e: "1000", sd: "0x32" }],
        ["scientific sd", { et: "engagement", e: "1000", sd: "1e1" }],
        ["signed sd", { et: "engagement", e: "1000", sd: "-50" }],
        ["whitespace sd", { et: "engagement", e: "1000", sd: "50 " }],
        ["empty sd", { et: "engagement", e: "1000", sd: "" }],
        ["with custom event name", { et: "engagement", e: "5000", en: "x" }],
        ["with event name engagement", { et: "engagement", en: "engagement", e: "1000" }],
        ["with properties", { et: "engagement", e: "5000", ep: "{}" }],
        ["with hit type", { et: "engagement", e: "5000", ht: "1" }],
        ["e without et", { e: "5000" }],
        ["sd without et", { sd: "50" }],
        ["sd=1 without e", { et: "engagement", sd: "1" }],
        ["sd=100 without e", { et: "engagement", sd: "100" }],
        ["e with custom event name engagement", { en: "engagement", e: "5000" }],
        ["sd with custom event name engagement", { en: "engagement", sd: "50" }],
        ["GET request", null],
        ["e=0 without sd", { et: "engagement", e: "0" }],
        ["e=0 with sd=0", { et: "engagement", e: "0", sd: "0" }],
        ["sd=0 as only signal", { et: "engagement", sd: "0" }],
        ["sd=1 with e=0 but fractional", { et: "engagement", e: "0", sd: "1.5" }],
        ["e=999", { et: "engagement", e: "999" }],
        ["e=max+1", { et: "engagement", e: String(30 * 24 * 60 * 60 * 1000 + 1) }],
    ])(
        "rejects engagement with %s",
        async (_, engagementParams) => {
                        const send = siteEventsStub.record;
            const env = {
                SITE_EVENTS: siteEventsNamespace,
                VISITOR_SALT: "test-salt",
        };

            let request: Request;
            if (engagementParams === null) {
                request = new Request(
                    "https://example.com/collect?sid=example&h=example.com&p=/article&et=engagement&e=5000",
                    { headers: { "user-agent": defaultBrowserUserAgent } },
                );
            } else {
                request = new Request("https://example.com/collect", {
                    method: "POST",
                    headers: { "user-agent": defaultBrowserUserAgent },
                    body: new URLSearchParams({
                        sid: "example",
                        h: "example.com",
                        p: "/article",
                        r: "",
                        ...engagementParams,
                    }),
                });
            }

            const response = await collectRequestHandler(request, env as Env);

            expect(response.status).toBe(400);
            expect(siteEventsStub.record).not.toHaveBeenCalled();
            expect(send).not.toHaveBeenCalled();
        },
    );
});
