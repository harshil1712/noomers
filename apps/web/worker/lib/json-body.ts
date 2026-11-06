import { z } from "zod";
import { readCollectBody } from "../analytics/collect";

export const MAX_BODY_BYTES = 4 * 1024;

/**
 * Bounded, schema-validated JSON body for admin mutations: the 4 KiB
 * cap is the shared collection reader's (declared and streamed length).
 */
export async function readJsonBody<Schema extends z.ZodType>(
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
