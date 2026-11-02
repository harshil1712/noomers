import { describe, test, expect, vi } from "vitest";

const repository = {
    getByPlausibleScriptId: vi.fn(),
};

vi.mock("~/sites/repository", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/sites/repository")>();
    return {
        ...actual,
        SitesRepository: class {
            getByPlausibleScriptId = repository.getByPlausibleScriptId;
        },
    };
});

import { loader } from "../js.$script";

const site = {
    domain: "example.com",
    trackerId: "tracker-1",
    plausibleScriptId: "pa-AbCdEfGhIjKl",
    timezone: "Etc/UTC",
    customProperties: [],
    trackerScriptConfiguration: {},
};

function context() {
    return { cloudflare: { env: { DB: {} } } };
}

function request(script: string, host = "pa.example.com") {
    return new Request(`https://${host}/js/${script}`);
}

describe("/js/:script route", () => {
    test("serves the tracker for a known script id", async () => {
        repository.getByPlausibleScriptId.mockResolvedValue(site);
        const res = await loader({
            params: { script: "pa-AbCdEfGhIjKl.js" },
            request: request("pa-AbCdEfGhIjKl.js"),
            context: context(),
        } as never);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("application/javascript");
        expect(res.headers.get("Cache-Control")).toBe(
            "public, max-age=3600",
        );
        const body = await res.text();
        expect(body).toContain('domain:"example.com"');
        expect(body).toContain(
            'endpoint:"https://pa.example.com/api/event"',
        );
        expect(body).not.toContain("pa.harshil.app");
        expect(repository.getByPlausibleScriptId).toHaveBeenCalledWith(
            "pa-AbCdEfGhIjKl",
        );
    });

    test("404 for an unknown script id", async () => {
        repository.getByPlausibleScriptId.mockResolvedValue(null);
        const res = await loader({
            params: { script: "pa-UnknownId0.js" },
            request: request("pa-UnknownId0.js"),
            context: context(),
        } as never);
        expect(res.status).toBe(404);
    });

    test("404 for an invalid script id", async () => {
        const res = await loader({
            params: { script: "not-a-plausible-id.js" },
            request: request("not-a-plausible-id.js"),
            context: context(),
        } as never);
        expect(res.status).toBe(404);
        expect(repository.getByPlausibleScriptId).not.toHaveBeenCalledWith(
            "not-a-plausible-id",
        );
    });

    test("404 for a non-pa script name", async () => {
        const res = await loader({
            params: { script: "tracker.js" },
            request: request("tracker.js"),
            context: context(),
        } as never);
        expect(res.status).toBe(404);
    });
});
