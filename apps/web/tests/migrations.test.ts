/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { migrate } from "./helpers";
import { SitesRepository } from "../worker/sites/repository";

const TABLES = [
  "goals",
  "sites",
  "site_tombstones",
  "custom_properties",
  "user",
  "session",
  "account",
  "verification",
];

describe("D1 migration baseline", () => {
  beforeAll(migrate);

  test("creates every expected table with the baseline columns", async () => {
    for (const table of TABLES) {
      const row = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
        .bind(table)
        .first();
      expect(row, `missing table ${table}`).toBeTruthy();
    }

    const goalColumns = await env.DB.prepare("PRAGMA table_info(goals)").all<{ name: string }>();
    expect(goalColumns.results.map((r) => r.name)).toContain("currency");
  });

  test("site deletion records a tombstone", async () => {
    const domain = "deleteme.example";
    const repository = new SitesRepository(env.DB);
    await repository.create({ domain });
    await expect(repository.delete(domain)).resolves.toBe(true);

    const tombstone = await env.DB.prepare("SELECT domain FROM site_tombstones WHERE domain = ?")
      .bind(domain)
      .first();
    expect(tombstone).toBeTruthy();
  });
});
