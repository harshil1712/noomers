import { describe, test, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { collectRequestHandler } from "../worker/analytics/collect";
import { createSiteEventsStub } from "../worker/__testutils__/site-events";

const { stub: siteEventsStub, namespace: siteEventsNamespace } = createSiteEventsStub();
const siteEventsRecord = siteEventsStub.record;
const browserUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const originalTZ = process.env.TZ;

describe("collect endpoint", () => {
  let mockEnv: any;

  beforeEach(() => {
    // Set timezone to EST for all tests
    process.env.TZ = "EST";
    vi.clearAllMocks();
    mockEnv = {
      SITE_EVENTS: siteEventsNamespace,
      VISITOR_SALT: "test-salt",
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({ status: "active" }),
        })),
      },
    };
  });

  afterEach(() => {
    // Restore the original timezone
    process.env.TZ = originalTZ;
  });

  test("accepts ht parameter and doesn't return Last-Modified header", async () => {
    // Create a request with ht parameter
    const requestWithHt = new Request(
      "https://example.com/collect?sid=test-site&p=/test&h=example.com&r=&ht=1",
      { headers: { "user-agent": browserUserAgent } },
    );

    const response = await collectRequestHandler(requestWithHt, mockEnv);

    // Verify standard headers
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/gif");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Pragma")).toBe("no-cache");

    // The key assertion: Last-Modified header should NOT be present when ht is provided
    expect(response.headers.get("Last-Modified")).toBeNull();
  });

  test("handles invalid ht parameter", async () => {
    // Create a request with invalid ht parameter
    const requestWithInvalidHt = new Request(
      "https://example.com/collect?sid=test-site&p=/test&h=example.com&r=&ht=invalid",
      { headers: { "user-agent": browserUserAgent } },
    );

    const response = await collectRequestHandler(requestWithInvalidHt, mockEnv);

    expect(response.status).toBe(200);

    // Even with invalid ht, we should NOT set Last-Modified
    // because we're still using the ht parameter path
    expect(response.headers.get("Last-Modified")).toBeNull();
  });

  test("falls back to cache headers when hits is not provided", async () => {
    // Use a fixed date for testing
    const initialDate = new Date("2025-04-01T12:00:00Z");
    const initialDateString = initialDate.toUTCString();

    // Create a request without v and b parameters but with If-Modified-Since header
    const headers = new Headers();
    headers.set("user-agent", browserUserAgent);
    headers.set("If-Modified-Since", initialDateString);

    const requestWithoutVB = new Request(
      "https://example.com/collect?sid=test-site&p=/test&h=example.com&r=",
      { headers },
    );

    const response = await collectRequestHandler(requestWithoutVB, mockEnv);

    expect(response.status).toBe(200);

    // Last-Modified is no longer emitted; visits are sessionized server-side.
    expect(response.headers.get("Last-Modified")).toBeNull();
    expect(siteEventsRecord).toHaveBeenCalledOnce();
  });

  test("drops a bot user agent with a tracking pixel and a dropped marker", async () => {
    const request = new Request(
      "https://example.com/collect?sid=test-site&p=/test&h=example.com&r=",
      {
        headers: { "user-agent": "agent-browser" },
      },
    );

    const response = await collectRequestHandler(request, mockEnv);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/gif");
    expect(response.headers.get("x-noomers-dropped")).toBe("1");
    expect(response.headers.get("Last-Modified")).toBeNull();
    expect(siteEventsRecord).not.toHaveBeenCalled();
  });

  test("preserves the first-party server tracker UA", async () => {
    const request = new Request(
      "https://example.com/collect?sid=test-site&p=/test&h=example.com&r=",
      {
        headers: { "user-agent": "noomers-tracker-server/3.4.1" },
      },
    );

    const response = await collectRequestHandler(request, mockEnv);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-noomers-dropped")).toBeNull();
    expect(siteEventsRecord).toHaveBeenCalledOnce();
  });

  test("accepts native engagement events without a cache header", async () => {
    const env = { ...mockEnv };
    const request = new Request("https://example.com/collect", {
      method: "POST",
      headers: { "user-agent": browserUserAgent },
      body: new URLSearchParams({
        sid: "test-site",
        h: "example.com",
        p: "/article",
        r: "",
        et: "engagement",
        e: "5000",
      }),
    });

    const response = await collectRequestHandler(request, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/gif");
    expect(response.headers.get("Last-Modified")).toBeNull();
    expect(siteEventsRecord).toHaveBeenCalledOnce();
    expect(siteEventsRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "engagement",
        engagement_time: 5000,
      }),
    );
  });

  test("sends the canonical event to EVENT_STREAM and records it in the DO", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const env = { ...mockEnv, EVENT_STREAM: { send } };
    const request = new Request(
      "https://example.com/collect?sid=test-site&p=/test&h=example.com&r=&ht=1",
      { headers: { "user-agent": browserUserAgent } },
    );

    const response = await collectRequestHandler(request, env);

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
    const sent = send.mock.calls[0][0];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(
      expect.objectContaining({
        site_id: "test-site",
        event_type: "pageview",
        pathname: "/test",
        hostname: "example.com",
      }),
    );
    expect(siteEventsRecord).toHaveBeenCalledOnce();
  });

  test("EVENT_STREAM.send rejecting fails the request (fail-closed 500)", async () => {
    const send = vi.fn().mockRejectedValue(new Error("pipeline down"));
    const env = { ...mockEnv, EVENT_STREAM: { send } };
    const request = new Request(
      "https://example.com/collect?sid=test-site&p=/test&h=example.com&r=&ht=1",
      { headers: { "user-agent": browserUserAgent } },
    );

    const response = await collectRequestHandler(request, env);

    expect(response.status).toBe(500);
  });

  test("missing EVENT_STREAM (local dev) still records for realtime", async () => {
    const request = new Request(
      "https://example.com/collect?sid=test-site&p=/test&h=example.com&r=&ht=1",
      { headers: { "user-agent": browserUserAgent } },
    );

    const response = await collectRequestHandler(request, mockEnv);

    expect(response.status).toBe(200);
    expect(siteEventsRecord).toHaveBeenCalledOnce();
  });

  test("rejects native engagement with invalid time", async () => {
    const request = new Request("https://example.com/collect", {
      method: "POST",
      headers: { "user-agent": browserUserAgent },
      body: new URLSearchParams({
        sid: "test-site",
        h: "example.com",
        p: "/article",
        r: "",
        et: "engagement",
        e: "500",
      }),
    });

    const response = await collectRequestHandler(request, mockEnv);

    expect(response.status).toBe(400);
    expect(siteEventsRecord).not.toHaveBeenCalled();
  });
});
