import { afterEach, describe, expect, it, vi } from "vitest";

const realFetch = globalThis.fetch;

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.resetModules();
});

describe("DashboardApiError", () => {
  it("is thrown with the response status on non-2xx GET", async () => {
    stubFetch(403, { error: "Forbidden" });
    const { dashboardApi, DashboardApiError } = await import("../src/lib/dashboard-api");
    const err = await dashboardApi.sites().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DashboardApiError);
    expect((err as InstanceType<typeof DashboardApiError>).status).toBe(403);
    expect((err as Error).message).toBe("/api/dashboard/sites failed: 403");
  });
});

describe("refreshSites", () => {
  it("sets forbidden (not error) on a 403", async () => {
    stubFetch(403, { error: "Forbidden" });
    const { refreshSites, sitesSnapshot } = await import("../src/lib/use-sites");
    await refreshSites();
    expect(sitesSnapshot()).toEqual({ sites: null, error: false, forbidden: true });
  });

  it("sets error (not forbidden) on other failures", async () => {
    stubFetch(500, { error: "nope" });
    const { refreshSites, sitesSnapshot } = await import("../src/lib/use-sites");
    await refreshSites();
    expect(sitesSnapshot()).toMatchObject({ error: true, forbidden: false });
  });

  it("clears forbidden on success", async () => {
    stubFetch(403, {});
    const { refreshSites, sitesSnapshot } = await import("../src/lib/use-sites");
    await refreshSites();
    stubFetch(200, { details: [{ domain: "a.test", timezone: "UTC" }] });
    await refreshSites();
    expect(sitesSnapshot()).toEqual({
      sites: [{ domain: "a.test", timezone: "UTC" }],
      error: false,
      forbidden: false,
    });
  });
});
