import type { ReactNode } from "react";
import { Link } from "@cloudflare/kumo";
import { Link as RouterLink } from "@tanstack/react-router";
import { Logo } from "@noomers/brand/Logo.tsx";
import { useSession } from "../lib/auth-client";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { PRODUCT } from "../config";

/**
 * Operate-mode shell: a sticky top bar (logo, contextual slots, user menu)
 * instead of a sidebar. Child controls (site switcher, interval, live pill)
 * mount via <AppShell.Bar> children rendered beside the logo.
 */
export default function AppShell({
  children,
  controls,
}: {
  children: ReactNode;
  controls?: ReactNode;
}) {
  const { data } = useSession();
  return (
    <div className="min-h-dvh bg-kumo-canvas">
      <header className="sticky top-0 z-20 border-b border-kumo-hairline bg-kumo-elevated">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link
            variant="plain"
            render={<RouterLink to="/dashboard" />}
            aria-label={`${PRODUCT.name} dashboard`}
            className="text-kumo-default!"
          >
            <Logo size={22} />
          </Link>
          <div className="order-3 flex w-full flex-wrap items-center gap-2 sm:order-2 sm:w-auto sm:flex-1">
            {controls}
          </div>
          <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
            <ThemeToggle />
            {data?.user && <UserMenu user={data.user} />}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
