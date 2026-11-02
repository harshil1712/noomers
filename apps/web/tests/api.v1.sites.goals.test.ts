/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";
import { migrate, seedSite, seedGoal } from "./helpers";

function request(path: string, method = "GET", body?: unknown) {
    return SELF.fetch(`https://analytics.example${path}`, {
        method,
        headers: {
            Authorization: "Bearer sites-secret",
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe("Plausible Sites goals API", () => {
    beforeAll(async () => {
        await migrate();
        await seedSite("goals.example");
        await seedGoal("goals.example", {
            id: "goal-1",
            name: "Signup",
            type: "event",
            value: "Signup",
            customProps: { plan: "pro" },
        });
    });

    test("lists goals in Plausible format", async () => {
        const response = await request("/api/v1/sites/goals?site_id=goals.example");
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
        const response = await request("/api/v1/sites/goals", "PUT", {
            site_id: "goals.example",
            goal_type: "event",
            event_name: "Signup",
            custom_props: { plan: "pro" },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            domain: "goals.example",
            id: "goal-1",
            goal_type: "event",
        });
    });

    test("creates page goals with Plausible defaults", async () => {
        const response = await request("/api/v1/sites/goals", "PUT", {
            site_id: "goals.example",
            goal_type: "page",
            page_path: "/register",
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            domain: "goals.example",
            goal_type: "page",
            display_name: "Visit /register",
            page_path: "/register",
            event_name: null,
        });
    });

    test("deletes a goal", async () => {
        const id = await seedGoal("goals.example", {
            name: "Delete me",
            type: "event",
            value: "Delete me",
        });
        const response = await request(`/api/v1/sites/goals/${id}`, "DELETE", {
            site_id: "goals.example",
        });
        await expect(response.json()).resolves.toEqual({ deleted: "true" });
    });
});
