/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";
import { migrate } from "./helpers";

const BASE = "https://worker.test/api/maintenance/deletion-jobs";
const AUTH = { Authorization: "Bearer sites-secret" };

function job(id: string, site: string, requestedAt: string) {
  return env.DB.prepare(
    "INSERT INTO site_deletion_jobs (id, site_id, requested_at) VALUES (?, ?, ?)",
  )
    .bind(id, site, requestedAt)
    .run();
}

const ago = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

function post(id: string, body: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch(`${BASE}/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH, ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(migrate);

describe("/api/maintenance/deletion-jobs", () => {
  test("401 without a token", async () => {
    expect((await SELF.fetch(BASE)).status).toBe(401);
  });

  test("GET returns only due jobs", async () => {
    await job("due-1", "a.example", ago(2));
    await job("young-1", "b.example", ago(0.5));
    await job("done-1", "c.example", ago(3));
    await env.DB.prepare(
      "UPDATE site_deletion_jobs SET iceberg_status='completed', completed_at=? WHERE id='done-1'",
    )
      .bind(ago(3))
      .run();
    await job("retries-1", "d.example", ago(2));
    await env.DB.prepare(
      "UPDATE site_deletion_jobs SET attempt_count=10 WHERE id='retries-1'",
    ).run();

    const res = await SELF.fetch(BASE, { headers: AUTH });
    expect(res.status).toBe(200);
    const { jobs } = await res.json<{ jobs: { id: string }[] }>();
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain("due-1");
    expect(ids).not.toContain("young-1");
    expect(ids).not.toContain("done-1");
    expect(ids).not.toContain("retries-1");
  });

  test("POST completed updates the row", async () => {
    await job("r1", "e.example", ago(2));
    const res = await post("r1", { status: "completed" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: "r1",
      iceberg_status: "completed",
      attempt_count: 1,
    });
    const row = await env.DB.prepare(
      "SELECT iceberg_status, completed_at, attempt_count FROM site_deletion_jobs WHERE id='r1'",
    ).first<{ iceberg_status: string; completed_at: string | null; attempt_count: number }>();
    expect(row).toMatchObject({ iceberg_status: "completed", attempt_count: 1 });
    expect(row?.completed_at).toBeTruthy();
  });

  test("POST failed with error updates the row", async () => {
    await job("r2", "f.example", ago(2));
    const res = await post("r2", { status: "failed", error: "boom" });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT iceberg_status, iceberg_error, completed_at, attempt_count FROM site_deletion_jobs WHERE id='r2'",
    ).first<{
      iceberg_status: string;
      iceberg_error: string;
      completed_at: string | null;
      attempt_count: number;
    }>();
    expect(row).toMatchObject({
      iceberg_status: "failed",
      iceberg_error: "boom",
      completed_at: null,
      attempt_count: 1,
    });
  });

  test("error with completed → 400; unknown key → 400; unknown id → 404; completed → 409", async () => {
    expect((await post("r1", { status: "completed", error: "x" })).status).toBe(400);
    await job("r3", "g.example", ago(2));
    expect((await post("r3", { status: "failed", nope: 1 })).status).toBe(400);
    expect((await post("nope-id", { status: "completed" })).status).toBe(404);
    expect((await post("r1", { status: "completed" })).status).toBe(409);
  });

  test("415 on non-JSON, 413 on oversized", async () => {
    expect(
      (
        await SELF.fetch(`${BASE}/x`, {
          method: "POST",
          headers: { "content-type": "text/plain", ...AUTH },
          body: "x",
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await SELF.fetch(`${BASE}/x`, {
          method: "POST",
          headers: { "content-type": "application/json", "content-length": "9999", ...AUTH },
          body: "{}",
        })
      ).status,
    ).toBe(413);
  });
});
