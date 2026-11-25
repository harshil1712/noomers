import { z } from "zod";
import { readJsonBody } from "../lib/json-body";
import { ApiKeysRepository } from "../api-keys/repository";
import type { Ctx } from "./dashboard";

const createBody = z
  .object({
    name: z.string().trim().min(1).max(64),
    scope: z.enum(["stats", "sites"]),
  })
  .strict();

/** GET /api/dashboard/api-keys — all keys, newest first. */
export async function listApiKeys(c: Ctx) {
  return Response.json({ api_keys: await new ApiKeysRepository(c.env.DB).list() });
}

/** POST /api/dashboard/api-keys — { name, scope } → 201 with the plaintext key once. */
export async function createApiKey(c: Ctx, request: Request, userId: string) {
  const body = await readJsonBody(request, createBody);
  if (body instanceof Response) return body;
  const { key, apiKey } = await new ApiKeysRepository(c.env.DB).create({
    name: body.name,
    scope: body.scope,
    createdBy: userId,
  });
  return Response.json({ ...apiKey, key }, { status: 201 });
}

/** DELETE /api/dashboard/api-keys/:id — idempotent revoke. */
export async function revokeApiKey(c: Ctx, id: string) {
  const found = await new ApiKeysRepository(c.env.DB).revoke(id);
  if (!found) return Response.json({ error: "API key not found" }, { status: 404 });
  return Response.json({ revoked: true });
}
