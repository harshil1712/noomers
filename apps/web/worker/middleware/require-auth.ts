import { createMiddleware } from "hono/factory";
import { createAuth } from "../auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  banned?: boolean | null;
  emailVerified: boolean;
}

export interface AuthVars {
  user: SessionUser;
}

/**
 * Requires a valid Better Auth session; puts the session user on the context
 * as `user`. Admin authorisation lives in the Better Auth admin plugin.
 */
export const requireAuth = createMiddleware<{ Bindings: Env; Variables: AuthVars }>(
  async (c, next) => {
    const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) return c.json({ error: "unauthorized" }, 401);
    c.set("user", session.user as SessionUser);
    await next();
  },
);
