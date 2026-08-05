import { beforeEach, describe, expect, test, vi } from "vitest";

import { action } from "../resources.goals";
import { isAuthEnabled, requireAuth } from "~/lib/auth";

vi.mock("~/lib/auth", () => ({
    isAuthEnabled: vi.fn(),
    requireAuth: vi.fn(),
}));

describe("Resources/Goals route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("rejects goal mutations when dashboard authentication is disabled", async () => {
        vi.mocked(isAuthEnabled).mockReturnValue(false);
        const request = new Request("https://example.com/resources/goals", {
            method: "POST",
            body: new URLSearchParams({
                intent: "create",
                site: "example.com",
                name: "Signup",
                type: "event",
                value: "Signup",
            }),
        });

        await expect(
            action({
                request,
                context: { cloudflare: { env: {} } },
            } as never),
        ).rejects.toMatchObject({ status: 403 });
        expect(requireAuth).not.toHaveBeenCalled();
    });
});
