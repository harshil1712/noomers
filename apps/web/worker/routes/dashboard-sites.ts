import { z } from "zod";
import { SitesRepository } from "../sites/repository";
import { deleteSite } from "../sites/service";
import { readCollectBody } from "../analytics/collect";
import type { Ctx } from "./dashboard";

const MAX_BODY_BYTES = 4 * 1024;

const createBody = z
  .object({
    domain: z.string().min(1),
    timezone: z.string().min(1).optional(),
  })
  .strict();

const patchBody = z
  .object({
    timezone: z.string().min(1),
  })
  .strict();

/**
 * Bounded, schema-validated JSON body for dashboard mutations: the 4 KiB
 * cap is the shared collection reader's (declared and streamed length).
 */
async function readJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<Response | z.infer<Schema>> {
  const text = await readCollectBody(request, MAX_BODY_BYTES);
  if (text === null) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }
  let json: z.infer<Schema>;
  try {
    json = schema.parse(JSON.parse(text || "{}"));
  } catch (error) {
    const message =
      error instanceof z.ZodError ? error.issues[0]?.message || "Invalid request" : "Invalid JSON";
    return Response.json({ error: message }, { status: 400 });
  }
  return json;
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/** POST /api/dashboard/sites — { domain, timezone? } → 201. */
export async function createDashboardSite(c: Ctx, request: Request) {
  const body = await readJsonBody(request, createBody);
  if (body instanceof Response) return body;
  try {
    const site = await new SitesRepository(c.env.DB).create(body);
    return Response.json(
      { domain: site.domain, timezone: site.timezone, trackerId: site.trackerId },
      { status: 201 },
    );
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request");
  }
}

/** PATCH /api/dashboard/sites/:domain — { timezone } → 200. */
export async function updateDashboardSite(c: Ctx, request: Request, domain: string) {
  const body = await readJsonBody(request, patchBody);
  if (body instanceof Response) return body;
  try {
    const site = await new SitesRepository(c.env.DB).update(domain, {
      timezone: body.timezone,
    });
    return site
      ? Response.json({ domain: site.domain, timezone: site.timezone })
      : Response.json({ error: "Site not found" }, { status: 404 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request");
  }
}

/** DELETE /api/dashboard/sites/:domain → 200 / 404 / 502 on purge failure. */
export async function deleteDashboardSite(c: Ctx, domain: string) {
  const result = await deleteSite(c.env, domain);
  if (!result.deleted) {
    return Response.json({ error: "Site not found" }, { status: 404 });
  }
  if (result.purgeFailed) {
    return Response.json(
      { deleted: true, warning: "Site deleted, but its realtime buffer could not be purged." },
      { status: 502 },
    );
  }
  return Response.json({ deleted: true });
}
