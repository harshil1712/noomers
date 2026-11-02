const { stub: siteEventsStub } =
    createSiteEventsStub();
const siteEventsRecord = siteEventsStub.record;

import { beforeEach, describe, expect, test, vi } from "vitest";
import { plausibleEventRequestHandler } from "../plausible";
import { createSiteEventsStub } from "../../__testutils__/site-events";

const browserUserAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function createEnv() {
    return {
        SITE_EVENTS: {
            idFromName: vi.fn((name: string) => name),
            get: vi.fn(() => ({ record: siteEventsRecord })),
        } as any,
        VISITOR_SALT: "test-secret",
        GOALS_DB: {
            prepare: vi.fn(() => ({
                bind: vi.fn().mockReturnThis(),
                first: vi.fn().mockResolvedValue({ status: "active" }),
            })),
        } as unknown as D1Database,
    } as any;
}

describe("Plausible Events API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        siteEventsRecord.mockClear();
        vi.setSystemTime(new Date("2026-08-02T12:00:00Z"));
    });

    test("rejects tombstoned sites before recording an event", async () => {
        const env = createEnv();
        const statement = {
            bind: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ status: "deleted" }),
        };
        env.GOALS_DB = {
            prepare: vi.fn(() => statement),
        } as unknown as D1Database;
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "user-agent": browserUserAgent,
            },
            body: JSON.stringify({
                name: "pageview",
                url: "https://example.com/",
                domain: "example.com",
            }),
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(410);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
        expect(siteEventsRecord).not.toHaveBeenCalled();
    });

    test.each([
        ["unprovisioned sites", { status: "unknown" }, 404],
        ["D1 failures", new Error("D1 unavailable"), 503],
    ])(
        "rejects %s before recording an event",
        async (_, result, expectedStatus) => {
            const env = createEnv();
            const first =
                result instanceof Error
                    ? vi.fn().mockRejectedValue(result)
                    : vi.fn().mockResolvedValue(result);
            env.GOALS_DB = {
                prepare: vi.fn(() => ({
                    bind: vi.fn().mockReturnThis(),
                    first,
                })),
            } as unknown as D1Database;
            const request = new Request("https://analytics.example/api/event", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "user-agent": browserUserAgent,
                },
                body: JSON.stringify({
                    name: "pageview",
                    url: "https://example.com/",
                    domain: "example.com",
                }),
            });

            const response = await plausibleEventRequestHandler(request, env);

            expect(response.status).toBe(expectedStatus);
            expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
                "*",
            );
            expect(siteEventsRecord).not.toHaveBeenCalled();
        },
    );

    test("returns 503 when the site registry binding is missing", async () => {
        const env = { ...createEnv(), GOALS_DB: undefined };
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "user-agent": browserUserAgent,
            },
            body: JSON.stringify({
                name: "pageview",
                url: "https://example.com/",
                domain: "example.com",
            }),
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(503);
        expect(siteEventsRecord).not.toHaveBeenCalled();
    });

    test("accepts the compact payload emitted by the official tracker", async () => {
        const env = createEnv();
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "text/plain",
                "user-agent": browserUserAgent,
                "cf-connecting-ip": "203.0.113.42",
            },
            body: JSON.stringify({
                n: "Signup",
                v: 34,
                u: "https://example.com/signup?utm_source=newsletter&utm_medium=email&token=secret",
                d: "example.com",
                r: "https://search.example/result?token=ref-secret#private",
                p: { plan: "pro", seats: 3, trial: true },
                i: false,
                $: { amount: 15.99, currency: "usd" },
            }),
        });

        const response = await plausibleEventRequestHandler(request, env, {
            country: "US",
            region: "California",
            city: "San Francisco",
        });

        expect(response.status).toBe(202);
        expect(await response.text()).toBe("ok");
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
        expect(siteEventsRecord).toHaveBeenCalledOnce();
        expect(siteEventsRecord).toHaveBeenCalledWith(
            expect.objectContaining({
                schema_version: 2,
                site_id: "example.com",
                event_type: "custom",
                event_name: "Signup",
                event_properties: JSON.stringify({
                    plan: "pro",
                    seats: 3,
                    trial: true,
                }),
                url: "https://example.com/signup",
                hostname: "example.com",
                pathname: "/signup",
                referrer: "https://search.example/result",
                interactive: false,
                revenue_amount: "15.99",
                revenue_currency: "USD",
                country: "US",
                region: "California",
                city: "San Francisco",
                utm_source: "newsletter",
                utm_medium: "email",
                visitor_id: expect.stringMatching(/^[0-9a-f]{64}$/),
            }),
        );
        const durableEvent = siteEventsRecord.mock.calls[0][0];
        expect(Object.values(durableEvent)).not.toContain("203.0.113.42");
        expect(Object.values(durableEvent)).not.toContain(browserUserAgent);
        expect(Object.values(durableEvent).join(" ")).not.toContain("secret");
    });

    test("accepts the documented long JSON payload and pageview properties", async () => {
        const env = createEnv();
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "application/json; charset=utf-8",
                "user-agent": browserUserAgent,
                "cf-connecting-ip": "203.0.113.42",
            },
            body: JSON.stringify({
                name: "pageview",
                url: "https://example.com/pricing",
                domain: "example.com",
                referrer: "https://example.org/",
                props: { author: "Ada" },
            }),
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(202);
        const analyticsPoint = vi.mocked(siteEventsRecord).mock
            .calls[0][0];
        expect(analyticsPoint?.event_name).toBe("pageview");
        expect(siteEventsRecord).toHaveBeenCalledWith(
            expect.objectContaining({
                event_type: "pageview",
                event_name: "pageview",
                event_properties: JSON.stringify({ author: "Ada" }),
            }),
        );
    });

    test("decodes percent-encoded pathnames", async () => {
        const env = createEnv();
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "user-agent": browserUserAgent,
            },
            body: JSON.stringify({
                name: "pageview",
                url: "https://example.com/hello%20world",
                domain: "example.com",
            }),
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(202);
        expect(siteEventsRecord).toHaveBeenCalledWith(
            expect.objectContaining({
                pathname: "/hello world",
                url: "https://example.com/hello world",
            }),
        );
    });

    test("hashes long Analytics Engine indexes without changing the domain", async () => {
        const env = createEnv();
        const domain = "mobile-app-".repeat(10);
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "user-agent": browserUserAgent,
            },
            body: JSON.stringify({
                name: "pageview",
                url: "/home",
                domain,
            }),
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(202);
        expect(siteEventsRecord).toHaveBeenCalledWith(
            expect.objectContaining({ site_id: domain }),
        );
    });

    test("stores engagement without exposing it as a custom Analytics Engine event", async () => {
        const env = createEnv();
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "text/plain",
                "user-agent": browserUserAgent,
            },
            body: JSON.stringify({
                n: "engagement",
                v: 34,
                u: "https://example.com/article",
                d: "example.com",
                p: {},
                e: 4312,
                sd: 72,
            }),
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(202);
        expect(siteEventsRecord).toHaveBeenCalledWith(
            expect.objectContaining({
                event_type: "engagement",
                engagement_time: 4312,
                scroll_depth: 72,
            }),
        );
    });

    test("includes the fragment in hash-based routes", async () => {
        const env = createEnv();
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "text/plain",
                "user-agent": browserUserAgent,
            },
            body: JSON.stringify({
                n: "pageview",
                v: 34,
                u: "https://example.com/app#settings%2Fprofile",
                d: "example.com",
                h: 1,
            }),
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(202);
        expect(siteEventsRecord).toHaveBeenCalledWith(
            expect.objectContaining({
                pathname: "/app#settings/profile",
                url: "https://example.com/app#settings/profile",
            }),
        );
    });

    test("parses campaigns and fragments in relative hash-based routes", async () => {
        const env = createEnv();
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "user-agent": browserUserAgent,
            },
            body: JSON.stringify({
                name: "pageview",
                url: "/app?utm_source=newsletter#settings",
                domain: "example.com",
                hashBasedRouting: true,
            }),
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(202);
        expect(siteEventsRecord).toHaveBeenCalledWith(
            expect.objectContaining({
                hostname: "(none)",
                pathname: "/app#settings",
                url: "/app#settings",
                utm_source: "newsletter",
            }),
        );
    });

    test("preserves valid large properties in the durable event", async () => {
        const env = createEnv();
        const props = Object.fromEntries(
            Array.from({ length: 30 }, (_, index) => [
                `property-${index}`,
                "x".repeat(2000),
            ]),
        );
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "user-agent": browserUserAgent,
            },
            body: JSON.stringify({
                name: "Signup",
                url: "https://example.com/signup",
                domain: "example.com",
                props,
            }),
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(202);
        expect(siteEventsRecord).toHaveBeenCalledWith(
            expect.objectContaining({
                event_properties: JSON.stringify(props),
            }),
        );
    });

    test("marks bot events as dropped without recording them", async () => {
        const env = createEnv();
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
            },
            body: JSON.stringify({
                name: "pageview",
                url: "https://example.com/",
                domain: "example.com",
            }),
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(202);
        expect(response.headers.get("x-plausible-dropped")).toBe("1");
        expect(siteEventsRecord).not.toHaveBeenCalled();
    });

    test("exempts the first-party server tracker UA prefix", async () => {
        const env = createEnv();
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "user-agent": "noomers-tracker-server/3.4.1",
            },
            body: JSON.stringify({
                name: "pageview",
                url: "https://example.com/",
                domain: "example.com",
            }),
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(202);
        expect(response.headers.get("x-plausible-dropped")).toBeNull();
        expect(siteEventsRecord).toHaveBeenCalledOnce();
    });

    test("returns the selected client IP for debug requests", async () => {
        const env = { ...createEnv(), SERVER_EVENTS_TOKEN: "s3cr3t" };
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "x-debug-request": "true",
                authorization: "Bearer s3cr3t",
                "x-forwarded-for": "invalid, 2001:db8::1, 203.0.113.42",
            },
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("text/plain");
        expect(await response.text()).toBe("2001:db8::1");
    });

    test("handles CORS preflight requests", async () => {
        const env = createEnv();
        const request = new Request("https://analytics.example/api/event", {
            method: "OPTIONS",
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(204);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
        expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
            "Content-Type, X-Debug-Request",
        );
    });

    test.each([
        ["invalid JSON", "application/json", "not-json", 400],
        [
            "an unsupported content type",
            "application/x-www-form-urlencoded",
            "",
            415,
        ],
        ["missing required fields", "application/json", "{}", 400],
        [
            "an event name over 120 characters",
            "application/json",
            JSON.stringify({
                name: "x".repeat(121),
                url: "https://example.com/",
                domain: "example.com",
            }),
            400,
        ],
        [
            "an oversized property value",
            "application/json",
            JSON.stringify({
                name: "Signup",
                url: "https://example.com/",
                domain: "example.com",
                props: { label: "x".repeat(2001) },
            }),
            400,
        ],
    ])("rejects %s", async (_, contentType, body, expectedStatus) => {
        const env = createEnv();
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": contentType,
                "user-agent": browserUserAgent,
            },
            body,
        });

        const response = await plausibleEventRequestHandler(request, env);

        expect(response.status).toBe(expectedStatus);
        expect(siteEventsRecord).not.toHaveBeenCalled();
    });
});

describe("Hardening", () => {
    const baseBody = () =>
        JSON.stringify({
            name: "pageview",
            url: "https://example.com/",
            domain: "example.com",
        });
    const req = (extra: Record<string, string> = {}, body = baseBody()) =>
        new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "user-agent": browserUserAgent,
                "cf-connecting-ip": "1.2.3.4",
                ...extra,
            },
            body,
        });

    test("x-forwarded-for is ignored without SERVER_EVENTS_TOKEN", async () => {
        const env = createEnv();
        const response = await plausibleEventRequestHandler(
            req({ "x-forwarded-for": "9.9.9.9", "x-debug-request": "true" }),
            env,
        );
        expect(await response.text()).toBe("1.2.3.4");
    });

    test("x-forwarded-for accepted with SERVER_EVENTS_TOKEN bearer", async () => {
        const env = { ...createEnv(), SERVER_EVENTS_TOKEN: "s3cr3t" };
        const response = await plausibleEventRequestHandler(
            req({
                "x-forwarded-for": "9.9.9.9",
                authorization: "Bearer s3cr3t",
                "x-debug-request": "true",
            }),
            env,
        );
        expect(await response.text()).toBe("9.9.9.9");
    });

    test("503 with CORS when VISITOR_SALT is missing", async () => {
        const env = createEnv();
        env.VISITOR_SALT = undefined;
        const response = await plausibleEventRequestHandler(req(), env);
        expect(response.status).toBe(503);
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });

    test("self-referral is dropped (www-insensitive)", async () => {
        const env = createEnv();
        const response = await plausibleEventRequestHandler(
            req({}, JSON.stringify({
                name: "pageview",
                url: "https://www.example.com/",
                domain: "example.com",
                referrer: "https://example.com/about",
            })),
            env,
        );
        expect(response.status).toBe(202);
        const recorded = siteEventsRecord.mock.calls[0][0] as {
            referrer?: string;
        };
        expect(recorded.referrer).toBe("");
    });
});
