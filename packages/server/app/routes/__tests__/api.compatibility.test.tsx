import { describe, expect, test, vi } from "vitest";
import { action as eventAction, loader as eventLoader } from "../api.event";
import { loader as healthLoader } from "../api.health";

describe("Plausible compatibility routes", () => {
    test("exposes the health endpoint", async () => {
        const response = healthLoader();

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("ok");
    });

    test("rejects GET requests to the event endpoint", async () => {
        const response = eventLoader();

        expect(response.status).toBe(405);
        expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
    });

    test("routes official tracker payloads into analytics", async () => {
        const writeDataPoint = vi.fn();
        const request = new Request("https://analytics.example/api/event", {
            method: "POST",
            headers: {
                "content-type": "text/plain",
                "user-agent":
                    "Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
            },
            body: JSON.stringify({
                n: "pageview",
                v: 34,
                u: "https://example.com/",
                d: "example.com",
                r: null,
            }),
        });

        const response = await eventAction({
            request,
            context: {
                cloudflare: {
                    env: {
                        WEB_COUNTER_AE: { writeDataPoint },
                        GOALS_DB: {
                            prepare: vi.fn(() => ({
                                bind: vi.fn().mockReturnThis(),
                                first: vi.fn().mockResolvedValue({ status: "active" }),
                            })),
                        },
                    },
                    cf: { country: "US" },
                },
            },
        } as never);

        expect(response.status).toBe(202);
        expect(writeDataPoint).toHaveBeenCalledOnce();
    });
});
