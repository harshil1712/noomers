import { readJsonBody } from "../lib/json-body";
import { z } from "zod";
import { SitesRepository } from "../sites/repository";
import { deleteSite } from "../sites/service";
import type { Ctx } from "./dashboard";

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
