import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { SitesRepository, siteResponse } from "../repository";

describe("SitesRepository", () => {
  const first = vi.fn();
  const all = vi.fn();
  const run = vi.fn();
  const bind = vi.fn(() => ({ first, all, run }));
  const batch = vi.fn(async (stmts: unknown[]) =>
    (stmts as { run: () => unknown }[]).map(() => ({ meta: { changes: 1 } })),
  );
  const prepare = vi.fn(() => ({ bind }));
  const repository = new SitesRepository({ prepare, batch } as unknown as D1Database);

  beforeEach(() => {
    vi.clearAllMocks();
    first.mockResolvedValue(null);
    run.mockResolvedValue({ success: true, meta: { changes: 1 } });
  });

  test("creates normalized sites with resolved tracker settings", async () => {
    const site = await repository.create({
      domain: " Example.COM ",
      timezone: "Europe/London",
      trackerScriptConfiguration: { outbound_links: true },
    });

    expect(site.domain).toBe("example.com");
    expect(site.trackerId).toBeTruthy();
    expect(site.timezone).toBe("Europe/London");
    expect(site.trackerScriptConfiguration.outbound_links).toBe(true);
    expect(site.trackerScriptConfiguration.file_downloads).toBe(false);
    expect(bind).toHaveBeenCalledWith(
      "example.com",
      site.trackerId,
      "Europe/London",
      JSON.stringify(site.trackerScriptConfiguration),
    );
    expect(siteResponse(site)).toMatchObject({
      domain: "example.com",
      custom_properties: [],
      tracker_script_configuration: {
        id: site.trackerId,
        outbound_links: true,
      },
    });
  });

  test("hydrates defaults around stored tracker settings", async () => {
    first.mockResolvedValue({
      domain: "example.com",
      tracker_id: "tracker-1",
      timezone: "Etc/UTC",
      tracker_script_configuration: '{"form_submissions":true}',
      custom_properties: '["author","title"]',
    });

    const site = await repository.get("EXAMPLE.COM");
    expect(bind).toHaveBeenCalledWith("example.com");
    expect(site?.trackerScriptConfiguration).toMatchObject({
      form_submissions: true,
      outbound_links: false,
    });
    expect(site?.customProperties).toEqual(["author", "title"]);
  });

  test.each(["active", "deleted", "unknown"] as const)(
    "reports %s collection status",
    async (status) => {
      first.mockResolvedValue({ status });
      await expect(repository.collectionStatus("EXAMPLE.COM")).resolves.toBe(status);
      expect(bind).toHaveBeenCalledWith("example.com");
    },
  );

  test("returns stable forward pagination cursors", async () => {
    all.mockResolvedValue({
      results: ["a.com", "b.com", "c.com"].map((domain) => ({
        domain,
        tracker_id: `tracker-${domain}`,
        timezone: "Etc/UTC",
        tracker_script_configuration: "{}",
      })),
    });

    const page = await repository.list({ limit: 2 });
    expect(page.sites.map((site) => site.domain)).toEqual(["a.com", "b.com"]);
    expect(page.after).toBe("b.com");
    expect(page.before).toBeNull();
  });

  test("rejects invalid domains, timezones, and tracker options", async () => {
    await expect(repository.create({ domain: "https://example.com" })).rejects.toThrow(
      "valid domain",
    );
    await expect(
      repository.create({ domain: "example.com", timezone: "Moon/Base" }),
    ).rejects.toThrow("IANA timezone");
    await expect(
      repository.create({
        domain: "example.com",
        trackerScriptConfiguration: { outbound_links: "yes" as never },
      }),
    ).rejects.toThrow("must be a boolean");
    expect(prepare).not.toHaveBeenCalled();
  });

  test("rejects domain renames before mutating D1", async () => {
    first.mockResolvedValue({
      domain: "example.com",
      tracker_id: "tracker-1",
      timezone: "Etc/UTC",
      tracker_script_configuration: "{}",
    });

    await expect(
      repository.update("example.com", {
        domain: "renamed.example.com",
      }),
    ).rejects.toThrow("not supported");
    expect(run).not.toHaveBeenCalled();
  });

  test("partial update preserves tracker config", async () => {
    const existing = {
      domain: "example.com",
      tracker_id: "tracker-1",
      timezone: "Europe/Berlin",
      tracker_script_configuration: JSON.stringify({
        outbound_links: true,
        file_downloads: false,
      }),
      custom_properties: "[]",
    };
    first.mockResolvedValue(existing);

    const site = await repository.update("example.com", {
      trackerScriptConfiguration: { file_downloads: true },
    });

    expect(site?.timezone).toBe("Europe/Berlin");
    expect(site?.trackerScriptConfiguration.outbound_links).toBe(true);
    expect(site?.trackerScriptConfiguration.file_downloads).toBe(true);
    expect(bind).toHaveBeenCalledWith(
      "example.com",
      "Europe/Berlin",
      expect.stringContaining('"outbound_links":true'),
      expect.any(String),
      "example.com",
    );
  });

  test("update without a timezone keeps the stored value", async () => {
    first.mockResolvedValue({
      domain: "example.com",
      tracker_id: "tracker-1",
      timezone: "Etc/UTC",
      tracker_script_configuration: "{}",
      custom_properties: "[]",
    });
    const site = await repository.update("example.com", {});
    expect(site?.timezone).toBe("Etc/UTC");
    expect(bind).toHaveBeenCalledWith(
      "example.com",
      "Etc/UTC",
      expect.any(String),
      expect.any(String),
      "example.com",
    );
  });

  test("prevents deleted domains from being registered again", async () => {
    first.mockResolvedValue({ domain: "example.com" });

    await expect(repository.create({ domain: "example.com" })).rejects.toThrow(
      "cannot be registered again",
    );
    expect(run).not.toHaveBeenCalled();
  });

  test("atomically tombstones, removes configuration, and creates a deletion job", async () => {
    const batch = vi
      .fn()
      .mockResolvedValue([
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
      ]);
    const deletionRepository = new SitesRepository({
      prepare,
      batch,
    } as unknown as D1Database);

    await expect(deletionRepository.delete("example.com")).resolves.toBe(true);
    expect(batch).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR IGNORE INTO site_tombstones"),
    );
    expect(prepare).toHaveBeenCalledWith("DELETE FROM custom_properties WHERE site_id = ?");
  });
});
