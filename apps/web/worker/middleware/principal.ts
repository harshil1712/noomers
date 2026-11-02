import { createMiddleware } from "hono/factory";
import { createAuth } from "../auth";
import { errorJson } from "../api/errors";

/**
 * Whoever is calling: a session user. The shared service/API layers only see
 * this type; agent principals (API keys) land with the agent API.
 */
export interface Principal {
  userId: string;
}

declare module "hono" {
  interface ContextVariableMap {
    principal: Principal;
  }
}

export interface PrincipalVars {
  principal: Principal;
}

/**
 * Web-app authentication: Better Auth session cookie → principal.
 */
export const sessionPrincipal = createMiddleware<{
  Bindings: Env;
  Variables: PrincipalVars;
}>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return errorJson(c, 401, "unauthorized", "Authentication required");
  }
  c.set("principal", { userId: session.user.id });
  await next();
});
