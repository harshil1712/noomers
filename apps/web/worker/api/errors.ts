import type { Context } from "hono";
import type { ClientErrorStatusCode, ServerErrorStatusCode } from "hono/utils/http-status";
import type { ZodError, ZodType } from "zod";

export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * Uniform error envelope shared by the API routes:
`{ error: { code, message, requestId, details? } }` on every non-2xx.
 */
export function errorJson(
  c: Context,
  status: ClientErrorStatusCode | ServerErrorStatusCode,
  code: string,
  message: string,
  details?: ErrorDetail[],
) {
  const error = { code, message, requestId: c.get("requestId"), details };
  return c.json({ error }, status);
}

/** `{"application/json": { schema }}` for createRoute request/response
 * content declarations. */
export const json = <T extends ZodType>(schema: T) => ({
  "application/json": { schema },
});

/**
 * Shared router `onError`: failures are logged (never echoed to clients)
 * and answered with a 500 `internal` envelope.
 */
export function onApiError(err: Error, c: Context) {
  console.error(
    JSON.stringify({
      level: "error",
      requestId: c.get("requestId"),
      path: c.req.path,
      method: c.req.method,
      message: err.message,
    }),
  );
  return errorJson(c, 500, "internal", "Something went wrong. Please try again.");
}

/**
 * Shared OpenAPIHono `defaultHook`: zod failures become the 400
 * `validation_failed` envelope, `details[].path` joined by ".".
 */
export const validationHook = (result: { success: boolean; error?: ZodError }, c: Context) => {
  if (result.success || !result.error) return;
  return errorJson(
    c,
    400,
    "validation_failed",
    "Request validation failed",
    result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  );
};
