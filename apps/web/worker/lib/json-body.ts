import { z } from "zod";

export const MAX_BODY_BYTES = 4 * 1024;

/**
 * Bounded, schema-validated JSON body for dashboard mutations: content-type
 * must be application/json and the payload is capped at 4 KiB on both the
 * declared length and the streamed body.
 */
export async function readJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<Response | z.infer<Schema>> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }
  let text = "";
  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return Response.json({ error: "Request body is too large" }, { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
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
