import { beforeEach, describe, expect, test, vi } from "vitest";

const repository = vi.hoisted(() => ({
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
}));

vi.mock("~/sites/repository", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/sites/repository")>();
    return {
        ...actual,
        SitesRepository: class {
            list = repository.list;
            create = repository.create;
            get = repository.get;
            update = repository.update;
            delete = repository.delete;
        },
    };
});

import { action as collectionAction, loader as collectionLoader } from "../api.v1.sites";
import { action as siteAction, loader as siteLoader } from "../api.v1.sites.$site_id";
import { loader as teamsLoader } from "../api.v1.sites.teams";
import { SINGLE_ORGANIZATION } from "~/sites/team";

const site = {
    domain: "example.com",
    trackerId: "tracker-1",
    timezone: "Europe/London",
    trackerScriptConfiguration: {
        installation_type: null,
        track_404_pages: false,
        hash_based_routing: false,
        outbound_links: true,
        file_downloads: false,
        revenue_tracking: false,
        tagged_events: false,
        form_submissions: false,
        pageview_props: false,
    },
};

function request(path: string, method = "GET", body?: unknown, token = "sites-secret") {
    return new Request(`https://analytics.example${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
}

const context = {
    cloudflare: {
        env: { SITES_API_TOKEN: "sites-secret", STATS_API_TOKEN: "stats-secret", GOALS_DB: {} },
    },
};

describe("Plausible Sites API", () => {
    beforeEach(() => vi.clearAllMocks());

    test("authenticates with the dedicated Sites API token", async () => {
        const response = await collectionLoader({
            request: request("/api/v1/sites", "GET", undefined, "stats-secret"),
            context,
        } as never);
        expect(response.status).toBe(401);
    });

    test("lists sites with pagination metadata", async () => {
        repository.list.mockResolvedValue({
            sites: [site],
            after: "next",
            before: null,
            limit: 25,
        });
        const response = await collectionLoader({
            request: request("/api/v1/sites?limit=25&after=cursor"),
            context,
        } as never);

        await expect(response.json()).resolves.toEqual({
            sites: [{ domain: "example.com", timezone: "Europe/London" }],
            meta: { after: "next", before: null, limit: 25 },
        });
        expect(repository.list).toHaveBeenCalledWith({
            after: "cursor",
            before: undefined,
            limit: 25,
        });
    });

    test("returns the synthetic organization and validates team_id", async () => {
        const teamsResponse = await teamsLoader({
            request: request("/api/v1/sites/teams"),
            context,
        } as never);
        await expect(teamsResponse.json()).resolves.toEqual({
            teams: [SINGLE_ORGANIZATION],
            meta: { after: null, before: null, limit: 100 },
        });

        const listResponse = await collectionLoader({
            request: request("/api/v1/sites?team_id=another-team"),
            context,
        } as never);
        expect(listResponse.status).toBe(400);

        const createResponse = await collectionAction({
            request: request("/api/v1/sites", "POST", {
                domain: "example.com",
                team_id: "another-team",
            }),
            context,
        } as never);
        expect(createResponse.status).toBe(400);
        expect(repository.list).not.toHaveBeenCalled();
        expect(repository.create).not.toHaveBeenCalled();
    });

    test("creates a site and returns resolved tracker configuration", async () => {
        repository.create.mockResolvedValue(site);
        const response = await collectionAction({
            request: request("/api/v1/sites", "POST", {
                domain: "example.com",
                timezone: "Europe/London",
                tracker_script_configuration: { outbound_links: true },
            }),
            context,
        } as never);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            domain: "example.com",
            timezone: "Europe/London",
            custom_properties: [],
            tracker_script_configuration: {
                id: "tracker-1",
                outbound_links: true,
            },
        });
    });

    test("gets, updates, and deletes a site", async () => {
        repository.get.mockResolvedValue(site);
        repository.update.mockResolvedValue({ ...site, timezone: "Etc/UTC" });
        repository.delete.mockResolvedValue(true);

        const getResponse = await siteLoader({
            request: request("/api/v1/sites/example.com"),
            context,
            params: { site_id: "example.com" },
        } as never);
        expect((await getResponse.json() as { domain: string }).domain).toBe("example.com");

        const putResponse = await siteAction({
            request: request("/api/v1/sites/example.com", "PUT", { timezone: "Etc/UTC" }),
            context,
            params: { site_id: "example.com" },
        } as never);
        expect((await putResponse.json() as { timezone: string }).timezone).toBe("Etc/UTC");

        const deleteResponse = await siteAction({
            request: request("/api/v1/sites/example.com", "DELETE"),
            context,
            params: { site_id: "example.com" },
        } as never);
        await expect(deleteResponse.json()).resolves.toEqual({ deleted: "true" });
    });
});
