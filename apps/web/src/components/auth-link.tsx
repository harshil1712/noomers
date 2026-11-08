import type { ReactNode } from "react";
import { Link } from "@cloudflare/kumo";
import { Link as RouterLink } from "@tanstack/react-router";

type AuthRoute = "/sign-in" | "/sign-up" | "/forgot-password";

/** Kumo-styled link that navigates with the router (auth page footers). */
export function AuthLink({ to, children }: { to: AuthRoute; children: ReactNode }) {
  return <Link render={<RouterLink to={to} />}>{children}</Link>;
}
