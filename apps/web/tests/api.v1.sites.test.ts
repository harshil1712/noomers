/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";
import { migrate, seedSite } from "./helpers";
import { SINGLE_ORGANIZATION } from "../worker/sites/team";

const AUTH = { Authorization: "Bearer sites-secret" };

function request(path: string, method = "GET", body?: unknown, token = "sites-secret") {
    return SELF.fetch(`https://analytics.example${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe("Plausible Sites API", () => {
    beforeAll(async () => {
        await migrate();
        await seedSite("example.com", { timezone: "Europe/London" });
    });

    test("authenticates with the dedicated Sites API token", async () => {
        const response = await request("/api/v1/sites", "GET", undefined, "stats-secret");
        expect(response.status).toBe(401);
    });

    test("lists sites with pagination metadata", async () => {
        const response = await request("/api/v1/sites?limit=25");
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            sites: [{ domain: "example.com", timezone: "Europe/London" }],
            meta: { after: null, before: null, limit: 25 },
        });
    });

    test("returns the synthetic organization and validates team_id", async () => {
        const teamsResponse = await request("/api/v1/sites/teams");
        await expect(teamsResponse.json()).resolves.toEqual({
            teams: [SINGLE_ORGANIZATION],
            meta: { after: null, before: null, limit: 100 },
        });

        const listResponse = await request("/api/v1/sites?team_id=another-team");
        expect(listResponse.status).toBe(400);

        const createResponse = await request("/api/v1/sites", "POST", {
            domain: "another.example",
            team_id: "another-team",
        });
        expect(createResponse.status).toBe(400);
        // nothing was created for the rejected team
        const row = await env.DB.prepare("SELECT domain FROM sites WHERE domain = ?")
            .bind("another.example")
            .first();
        expect(row).toBeNull();
    });

    test("creates a site and returns resolved tracker configuration", async () => {
        const response = await request("/api/v1/sites", "POST", {
            domain: "created.example",
            timezone: "Europe/London",
            tracker_script_configuration: { outbound_links: true },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            domain: "created.example",
            timezone: "Europe/London",
            custom_properties: [],
            tracker_script_configuration: {
                id: expect.any(String),
                outbound_links: true,
            },
        });
    });

    test("gets, updates, and deletes a site", async () => {
        const getResponse = await request("/api/v1/sites/example.com");
        expect((await getResponse.json() as { domain: string }).domain).toBe("example.com");

        const putResponse = await request("/api/v1/sites/example.com", "PUT", { timezone: "Etc/UTC" });
        expect((await putResponse.json() as { timezone: string }).timezone).toBe("Etc/UTC");

        const deleteResponse = await request("/api/v1/sites/example.com", "DELETE");
        await expect(deleteResponse.json()).resolves.toEqual({ deleted: "true" });
    });
});
