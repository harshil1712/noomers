import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { apiKeys } from "../../schema/api-keys";

export type ApiKeyScope = "stats" | "sites";

/** Public JSON shape — never exposes key_hash or created_by internals. */
export interface ApiKeyRecord {
  id: string;
  name: string;
  scope: ApiKeyScope;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

/** `nmr_` + 32 random bytes, base64url without padding (43 chars). */
export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `nmr_${base64}`;
}

/** SHA-256 lowercase hex — the only form of the key that is stored. */
export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class ApiKeysRepository {
  private db;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async create(
    input: { name: string; scope: ApiKeyScope; createdBy: string },
    now = Date.now(),
  ): Promise<{ key: string; apiKey: ApiKeyRecord }> {
    const key = generateApiKey();
    const row = {
      id: crypto.randomUUID(),
      name: input.name,
      scope: input.scope,
      keyHash: await hashApiKey(key),
      prefix: key.slice(0, 12),
      createdBy: input.createdBy,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    };
    await this.db.insert(apiKeys).values(row);
    return { key, apiKey: toRecord(row) };
  }

  async list(): Promise<ApiKeyRecord[]> {
    const rows = await this.db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
    return rows.map(toRecord);
  }

  /** Idempotent: already-revoked keys keep their original revoked_at. */
  async revoke(id: string, now = Date.now()): Promise<boolean> {
    const existing = await this.db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .get();
    if (!existing) return false;
    await this.db
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
    return true;
  }

  async findActiveByHash(hash: string): Promise<{ id: string; scope: ApiKeyScope } | null> {
    return (
      (await this.db
        .select({ id: apiKeys.id, scope: apiKeys.scope })
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
        .get()) ?? null
    );
  }

  /** Updates last_used_at at most once per minute. */
  async touch(id: string, now = Date.now()): Promise<void> {
    await this.db
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiKeys.id, id),
          or(isNull(apiKeys.lastUsedAt), lte(apiKeys.lastUsedAt, now - 60_000)),
        ),
      );
  }
}

function toRecord(row: typeof apiKeys.$inferSelect): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    prefix: row.prefix,
    created_at: row.createdAt,
    last_used_at: row.lastUsedAt,
    revoked_at: row.revokedAt,
  };
}
