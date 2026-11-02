import { beforeEach, describe, expect, test, vi } from "vitest";

const repositories = vi.hoisted(() => ({
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
}));

vi.mock("~/sites/repository", () => ({
    SitesRepository: class {
        get = repositories.get;
    },
}));

vi.mock("~/custom-properties/repository", () => ({
    CustomPropertiesRepository: class {
        list = repositories.list;
        create = repositories.create;
        delete = repositories.delete;
    },
}));

import { action as collectionAction, loader } from "../api.v1.sites.custom-props";
import { action as propertyAction } from "../api.v1.sites.custom-props.$property";

const context = {
    cloudflare: { env: { SITES_API_TOKEN: "secret", DB: {} } },
};

function request(path: string, method = "GET", fields?: Record<string, string>, auth = true) {
    const body = fields ? new FormData() : undefined;
    for (const [name, value] of Object.entries(fields || {})) body?.set(name, value);
    return new Request(`https://analytics.example${path}`, {
        method,
        headers: auth ? { Authorization: "Bearer secret" } : {},
        body,
    });
}

describe("Plausible custom properties API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        repositories.get.mockResolvedValue({ domain: "example.com" });
    });

    test("lists custom properties in the documented shape", async () => {
        repositories.list.mockResolvedValue(["author", "title"]);
        const response = await loader({
            request: request("/api/v1/sites/custom-props?site_id=example.com"),
            context,
        } as never);

        await expect(response.json()).resolves.toEqual({
            custom_properties: [{ property: "author" }, { property: "title" }],
        });
    });

    test("creates idempotently from multipart form data with a boolean response", async () => {
        repositories.create.mockResolvedValue(true);
        const response = await collectionAction({
            request: request("/api/v1/sites/custom-props", "PUT", {
                site_id: "example.com",
                property: "title",
            }),
            context,
        } as never);

        expect(repositories.create).toHaveBeenCalledWith("example.com", "title");
        await expect(response.json()).resolves.toEqual({ created: true });
    });

    test("deletes from multipart form data with a boolean response", async () => {
        repositories.delete.mockResolvedValue(true);
        const response = await propertyAction({
            request: request("/api/v1/sites/custom-props/title", "DELETE", {
                site_id: "example.com",
            }),
            context,
            params: { property: "title" },
        } as never);

        expect(repositories.delete).toHaveBeenCalledWith("example.com", "title");
        await expect(response.json()).resolves.toEqual({ deleted: true });
    });

    test("authenticates before reading multipart bodies", async () => {
        const response = await collectionAction({
            request: request("/api/v1/sites/custom-props", "PUT", undefined, false),
            context,
        } as never);
        expect(response.status).toBe(401);
    });
});
