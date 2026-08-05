import { beforeEach, describe, expect, test, vi } from "vitest";

const goals = vi.hoisted(() => ({
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
}));
const sites = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("~/goals/repository", () => ({
    GoalsRepository: class {
        list = goals.list;
        create = goals.create;
        delete = goals.delete;
    },
}));
vi.mock("~/sites/repository", () => ({
    SitesRepository: class {
        get = sites.get;
    },
}));

import { action, loader } from "../api.v1.sites.goals";
import { action as deleteAction } from "../api.v1.sites.goals.$goal_id";

const context = {
    cloudflare: {
        env: { SITES_API_TOKEN: "secret", GOALS_DB: {} },
    },
};

function request(path: string, method = "GET", body?: unknown) {
    return new Request(`https://analytics.example${path}`, {
        method,
        headers: {
            Authorization: "Bearer secret",
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
}

const eventGoal = {
    id: "goal-1",
    siteId: "example.com",
    name: "Signup",
    type: "event",
    value: "Signup",
    customProps: { plan: "pro" },
    createdAt: "2026-08-02T00:00:00.000Z",
};

describe("Plausible Sites goals API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sites.get.mockResolvedValue({ domain: "example.com" });
    });

    test("lists goals in Plausible format", async () => {
        goals.list.mockResolvedValue([eventGoal]);
        const response = await loader({
            request: request("/api/v1/sites/goals?site_id=example.com"),
            context,
        } as never);

        await expect(response.json()).resolves.toEqual({
            goals: [{
                id: "goal-1",
                goal_type: "event",
                display_name: "Signup",
                event_name: "Signup",
                page_path: null,
                custom_props: { plan: "pro" },
            }],
            meta: { after: null, before: null, limit: 100 },
        });
    });

    test("returns an existing matching goal idempotently", async () => {
        goals.list.mockResolvedValue([eventGoal]);
        const response = await action({
            request: request("/api/v1/sites/goals", "PUT", {
                site_id: "example.com",
                goal_type: "event",
                event_name: "Signup",
                custom_props: { plan: "pro" },
            }),
            context,
        } as never);

        expect(goals.create).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toMatchObject({
            domain: "example.com",
            id: "goal-1",
            goal_type: "event",
        });
    });

    test("creates page goals with Plausible defaults", async () => {
        goals.list.mockResolvedValue([]);
        goals.create.mockImplementation(async (input) => ({
            id: "goal-2",
            createdAt: "2026-08-02T00:00:00.000Z",
            ...input,
        }));
        const response = await action({
            request: request("/api/v1/sites/goals", "PUT", {
                site_id: "example.com",
                goal_type: "page",
                page_path: "/register",
            }),
            context,
        } as never);

        expect(response.status).toBe(200);
        expect(goals.create).toHaveBeenCalledWith({
            siteId: "example.com",
            type: "pageview",
            value: "/register",
            name: "Visit /register",
            customProps: {},
        });
    });

    test("deletes goals only within a registered site", async () => {
        goals.delete.mockResolvedValue(true);
        const response = await deleteAction({
            request: request("/api/v1/sites/goals/goal-1", "DELETE", {
                site_id: "example.com",
            }),
            context,
            params: { goal_id: "goal-1" },
        } as never);

        await expect(response.json()).resolves.toEqual({ deleted: "true" });
        expect(goals.delete).toHaveBeenCalledWith("example.com", "goal-1");
    });
});
