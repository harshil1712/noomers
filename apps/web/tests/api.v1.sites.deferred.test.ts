/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from "cloudflare:test";
import { describe, expect, test } from "vite-plus/test";

function request(path: string, method = "GET", auth = true) {
  return SELF.fetch(`https://analytics.example${path}`, {
    method,
    headers: auth ? { Authorization: "Bearer sites-secret" } : {},
  });
}

describe("deferred Sites API resources", () => {
  test.each([
    ["/api/v1/sites/guests", "GET"],
    ["/api/v1/sites/guests", "PUT"],
    ["/api/v1/sites/guests", "DELETE"],
    ["/api/v1/sites/guests/test@example.com", "DELETE"],
    ["/api/v1/sites/shared-links", "GET"],
    ["/api/v1/sites/shared-links", "PUT"],
    ["/api/v1/sites/shared-links", "DELETE"],
  ])("returns authenticated 501 for %s %s", async (path, method) => {
    const unauthorized = await request(path, method, false);
    expect(unauthorized.status).toBe(401);

    const response = await request(path, method);
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({ error: "Not Implemented" });
  });
});
