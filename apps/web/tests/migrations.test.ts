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
  "site_deletion_jobs",
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

    const columns = await env.DB.prepare("PRAGMA table_info(site_deletion_jobs)").all<{
      name: string;
    }>();
    expect(columns.results.map((row) => row.name)).toEqual([
      "id",
      "site_id",
      "requested_at",
      "iceberg_status",
      "iceberg_updated_at",
      "iceberg_error",
      "attempt_count",
      "completed_at",
    ]);
  });

  test("rejects completed_at while iceberg_status is pending", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO site_deletion_jobs (id, site_id, requested_at, completed_at)
                 VALUES ('job-check-1', 'check.example', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      ).run(),
    ).rejects.toThrow(/CHECK/i);
  });

  test("rejects a second job for the same site_id", async () => {
    const insert = (id: string) =>
      env.DB.prepare(
        "INSERT INTO site_deletion_jobs (id, site_id, requested_at) VALUES (?, 'unique.example', ?)",
      )
        .bind(id, "2026-01-01T00:00:00.000Z")
        .run();
    await insert("job-unique-1");
    await expect(insert("job-unique-2")).rejects.toThrow(/UNIQUE/i);
  });

  test("site deletion records a pending deletion job and a tombstone", async () => {
    const domain = "deleteme.example";
    const repository = new SitesRepository(env.DB);
    await repository.create({ domain });
    await expect(repository.delete(domain)).resolves.toBe(true);

    const jobs = await env.DB.prepare("SELECT * FROM site_deletion_jobs WHERE site_id = ?")
      .bind(domain)
      .all<{
        iceberg_status: string;
        attempt_count: number;
        completed_at: string | null;
      }>();
    expect(jobs.results).toHaveLength(1);
    expect(jobs.results[0]).toMatchObject({
      iceberg_status: "pending",
      attempt_count: 0,
      completed_at: null,
    });

    const tombstone = await env.DB.prepare("SELECT domain FROM site_tombstones WHERE domain = ?")
      .bind(domain)
      .first();
    expect(tombstone).toBeTruthy();
  });
});
