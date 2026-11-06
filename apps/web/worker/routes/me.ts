import { Hono } from "hono";
import { requireAuth, type AuthVars } from "../middleware/require-auth";

/** Example protected route — the pattern every authenticated API follows. */
export const meRoutes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

meRoutes.get("/api/me", requireAuth, (c) => {
  const user = c.get("user");
  return c.json({ user });
});
