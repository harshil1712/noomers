import { vi, test, describe, beforeEach, afterEach, expect } from "vitest";
import { handleFavicon } from "../worker/routes/favicon";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const mockCache = {
    match: vi.fn(),
    put: vi.fn(),
};

Object.defineProperty(globalThis, "caches", {
    value: { default: mockCache },
    writable: true,
});

describe("Favicon route", () => {
    const waitUntil = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockCache.match.mockResolvedValue(null);
        mockCache.put.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    test("returns 400 when url parameter is missing", async () => {
        const request = new Request("http://localhost:3000/favicon");
        const response = await handleFavicon(request, waitUntil);
        expect(response.status).toBe(400);
        expect(await response.text()).toBe("Missing url parameter");
    });

    test("fetches favicon from Google service when not cached", async () => {
        const faviconUrl = "https://example.com";
        const request = new Request(
            `http://localhost:3000/favicon?url=${encodeURIComponent(faviconUrl)}`,
        );

        mockFetch.mockResolvedValue(
            new Response("fake-favicon-data", {
                status: 200,
                headers: { "Content-Type": "image/x-icon" },
            }),
        );

        const response = await handleFavicon(request, waitUntil);

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("image/x-icon");
        expect(response.headers.get("Cache-Control")).toBe(
            "public, max-age=86400",
        );
        expect(response.headers.get("CDN-Cache-Control")).toBe(
            "public, max-age=2592000",
        );
        expect(mockFetch).toHaveBeenCalledWith(
            `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(faviconUrl)}&size=128`,
        );
        expect(waitUntil).toHaveBeenCalled();
    });

    test("returns cached response when available", async () => {
        const faviconUrl = "https://example.com";
        const request = new Request(
            `http://localhost:3000/favicon?url=${encodeURIComponent(faviconUrl)}`,
        );

        const cachedResponse = new Response("cached-favicon-data", {
            status: 200,
            headers: { "Content-Type": "image/x-icon" },
        });
        mockCache.match.mockResolvedValue(cachedResponse);

        const response = await handleFavicon(request, waitUntil);

        expect(response).toBe(cachedResponse);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 404 when Google favicon service returns 404", async () => {
        const faviconUrl = "https://nonexistent.com";
        const request = new Request(
            `http://localhost:3000/favicon?url=${encodeURIComponent(faviconUrl)}`,
        );

        mockFetch.mockResolvedValue(new Response("Not Found", { status: 404 }));

        const response = await handleFavicon(request, waitUntil);

        expect(response.status).toBe(404);
        expect(await response.text()).toBe("Favicon not found");
    });

    test("handles invalid URL parameter gracefully", async () => {
        const request = new Request(
            `http://localhost:3000/favicon?url=${encodeURIComponent("not-a-valid-url")}`,
        );

        const response = await handleFavicon(request, waitUntil);

        expect(response.status).toBe(500);
        expect(await response.text()).toBe("Error fetching favicon");
    });

    test("handles fetch errors gracefully", async () => {
        const faviconUrl = "https://example.com";
        const request = new Request(
            `http://localhost:3000/favicon?url=${encodeURIComponent(faviconUrl)}`,
        );

        mockFetch.mockRejectedValue(new Error("Network error"));

        const response = await handleFavicon(request, waitUntil);

        expect(response.status).toBe(500);
        expect(await response.text()).toBe("Error fetching favicon");
    });
});
