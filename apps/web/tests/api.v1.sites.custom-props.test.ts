/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";
import { migrate, seedSite, seedCustomProperty } from "./helpers";

function request(path: string, method = "GET", fields?: Record<string, string>, auth = true) {
    const body = fields ? new FormData() : undefined;
    for (const [name, value] of Object.entries(fields || {})) body?.set(name, value);
    return SELF.fetch(`https://analytics.example${path}`, {
        method,
        headers: auth ? { Authorization: "Bearer sites-secret" } : {},
        body,
    });
}

describe("Plausible custom properties API", () => {
    beforeAll(async () => {
        await migrate();
        await seedSite("props.example");
        await seedCustomProperty("props.example", "author");
        await seedCustomProperty("props.example", "title");
    });

    test("lists custom properties in the documented shape", async () => {
        const response = await request("/api/v1/sites/custom-props?site_id=props.example");
        await expect(response.json()).resolves.toEqual({
            custom_properties: [{ property: "author" }, { property: "title" }],
        });
    });

    test("creates idempotently from multipart form data with a boolean response", async () => {
        const response = await request("/api/v1/sites/custom-props", "PUT", {
            site_id: "props.example",
            property: "title",
        });
        await expect(response.json()).resolves.toEqual({ created: true });
    });

    test("deletes from multipart form data with a boolean response", async () => {
        const response = await request("/api/v1/sites/custom-props/author", "DELETE", {
            site_id: "props.example",
        });
        await expect(response.json()).resolves.toEqual({ deleted: true });
    });

    test("authenticates before reading multipart bodies", async () => {
        const response = await request("/api/v1/sites/custom-props", "PUT", undefined, false);
        expect(response.status).toBe(401);
    });
});
