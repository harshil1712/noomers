import { Hono } from "hono";
import { z } from "zod";
import { requireAPIKey } from "../api/auth";
import { readJsonBody } from "../lib/json-body";
import { DeletionJobsRepository } from "../sites/deletion-jobs";

const reportBody = z
  .object({
    status: z.enum(["completed", "failed"]),
    error: z.string().max(500).optional(),
  })
  .strict()
  .refine((v) => v.status === "failed" || v.error === undefined, {
    message: "error is only allowed with failed",
  });

export const maintenanceApi = new Hono<{ Bindings: Env }>()
  .use("/api/maintenance/*", async (c, next) => {
    const unauthorized = await requireAPIKey(c.req.raw, c.env);
    if (unauthorized) return unauthorized;
    await next();
  })
  .get("/api/maintenance/deletion-jobs", async (c) => {
    const jobs = await new DeletionJobsRepository(c.env.DB).listDue();
    return c.json({ jobs });
  })
  .post("/api/maintenance/deletion-jobs/:id", async (c) => {
    const body = await readJsonBody(c.req.raw, reportBody);
    if (body instanceof Response) return body;
    const result = await new DeletionJobsRepository(c.env.DB).report(
      c.req.param("id"),
      body.status,
      body.status === "failed" ? (body.error ?? null) : null,
    );
    if (!result.found) return c.json({ error: "Job not found" }, 404);
    if (result.alreadyCompleted) return c.json({ error: "Job already completed" }, 409);
    return c.json({
      id: c.req.param("id"),
      iceberg_status: body.status,
      attempt_count: result.attemptCount,
    });
  });
