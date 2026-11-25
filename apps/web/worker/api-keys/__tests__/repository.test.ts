/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { migrate } from "../../../tests/helpers";
import { ApiKeysRepository, generateApiKey, hashApiKey } from "../repository";

// `env` is typed as Cloudflare.Env (empty); the real bindings live on Env.
const db = () => (env as Env).DB;
const repository = () => new ApiKeysRepository(db());

describe("ApiKeysRepository", () => {
  beforeAll(migrate);

  test("create returns a nmr_ key, prefix and never stores plaintext", async () => {
    const { key, apiKey } = await repository().create(
      { name: "CI", scope: "stats", createdBy: "user-1" },
      1_000,
    );
    expect(key).toMatch(/^nmr_[A-Za-z0-9_-]{43}$/);
    expect(apiKey.prefix).toBe(key.slice(0, 12));
    expect(apiKey.created_at).toBe(1_000);
    expect(apiKey.last_used_at).toBeNull();
    expect(apiKey.revoked_at).toBeNull();

    const row = await db()
      .prepare("SELECT * FROM api_keys WHERE id = ?")
      .bind(apiKey.id)
      .first<{ key_hash: string; name: string; prefix: string; created_by: string }>();
    expect(row?.key_hash).toBe(await hashApiKey(key));
    expect(JSON.stringify(row)).not.toContain(key);
  });

  test("list is newest-first and includes revoked keys", async () => {
    const repo = repository();
    const first = await repo.create({ name: "old", scope: "stats", createdBy: "u" }, 100);
    const second = await repo.create({ name: "new", scope: "sites", createdBy: "u" }, 200);
    await repo.revoke(first.apiKey.id, 300);

    const list = await repo.list();
    const ids = list.map((k) => k.id);
    expect(ids.indexOf(second.apiKey.id)).toBeLessThan(ids.indexOf(first.apiKey.id));
    const revoked = list.find((k) => k.id === first.apiKey.id);
    expect(revoked?.revoked_at).toBe(300);
  });

  test("revoke is idempotent and returns false for unknown ids", async () => {
    const repo = repository();
    const { apiKey } = await repo.create({ name: "x", scope: "stats", createdBy: "u" });

    expect(await repo.revoke(apiKey.id, 1_000)).toBe(true);
    expect(await repo.revoke(apiKey.id, 2_000)).toBe(true);
    const kept = (await repo.list()).find((k) => k.id === apiKey.id);
    expect(kept?.revoked_at).toBe(1_000);

    expect(await repo.revoke(crypto.randomUUID())).toBe(false);
  });

  test("findActiveByHash ignores revoked keys", async () => {
    const repo = repository();
    const { key, apiKey } = await repo.create({ name: "x", scope: "stats", createdBy: "u" });
    const hash = await hashApiKey(key);
    expect(await repo.findActiveByHash(hash)).toMatchObject({
      id: apiKey.id,
      scope: "stats",
    });
    await repo.revoke(apiKey.id);
    expect(await repo.findActiveByHash(hash)).toBeNull();
    expect(await repo.findActiveByHash("0".repeat(64))).toBeNull();
  });

  test("touch updates last_used_at at most once per minute", async () => {
    const repo = repository();
    const { apiKey } = await repo.create({ name: "x", scope: "sites", createdBy: "u" });
    const lastUsed = async () =>
      (
        await db()
          .prepare("SELECT last_used_at FROM api_keys WHERE id = ?")
          .bind(apiKey.id)
          .first<{ last_used_at: number | null }>()
      )?.last_used_at;

    await repo.touch(apiKey.id, 10_000);
    expect(await lastUsed()).toBe(10_000);
    await repo.touch(apiKey.id, 10_000 + 30_000);
    expect(await lastUsed()).toBe(10_000);
    await repo.touch(apiKey.id, 10_000 + 60_001);
    expect(await lastUsed()).toBe(70_001);
  });

  test("generateApiKey produces unique keys", () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });
});
