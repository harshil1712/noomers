/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from "cloudflare:test";
import { describe, expect, test } from "vitest";

describe("assets fallback", () => {
    test("unknown worker-routed paths fall through to assets, not a Hono 404", async () => {
        // tests/fixtures/tracker.js is served by the ASSETS binding.
        const res = await SELF.fetch("https://x/assets/tracker.js");
        expect(res.status).toBe(200);
    });

    test("an unknown root .js path also reaches assets (no SPA index needed)", async () => {
        const res = await SELF.fetch("https://x/tracker.js");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("test tracker fixture");
    });

    test("unknown /api path still returns JSON 404", async () => {
        const res = await SELF.fetch("https://x/api/nope");
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "not found" });
    });
});
