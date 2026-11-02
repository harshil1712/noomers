import { describe, expect, test } from "vitest";
import { loader as guestsLoader, action as guestsAction } from "../api.v1.sites.guests";
import { action as guestAction } from "../api.v1.sites.guests.$email";
import { loader as linksLoader, action as linksAction } from "../api.v1.sites.shared-links";

const context = {
    cloudflare: { env: { SITES_API_TOKEN: "secret" } },
};

function request(path: string, method = "GET", auth = true) {
    return new Request(`https://analytics.example${path}`, {
        method,
        headers: auth ? { Authorization: "Bearer secret" } : {},
    });
}

describe("deferred Sites API resources", () => {
    test.each([
        [guestsLoader, "/api/v1/sites/guests", "GET"],
        [guestsAction, "/api/v1/sites/guests", "PUT"],
        [guestsAction, "/api/v1/sites/guests", "DELETE"],
        [guestAction, "/api/v1/sites/guests/test@example.com", "DELETE"],
        [linksLoader, "/api/v1/sites/shared-links", "GET"],
        [linksAction, "/api/v1/sites/shared-links", "PUT"],
        [linksAction, "/api/v1/sites/shared-links", "DELETE"],
    ])("returns authenticated 501 for %s", async (handler, path, method) => {
        const unauthorized = await handler({
            request: request(path, method, false),
            context,
            params: {},
        } as never);
        expect(unauthorized.status).toBe(401);

        const response = await handler({
            request: request(path, method),
            context,
            params: {},
        } as never);
        expect(response.status).toBe(501);
        await expect(response.json()).resolves.toEqual({ error: "Not Implemented" });
    });
});
