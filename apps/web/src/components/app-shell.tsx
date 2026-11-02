import type { ReactNode } from "react";
import { cn, Link, Sidebar, useSidebar } from "@cloudflare/kumo";
import { Link as RouterLink, useLocation } from "@tanstack/react-router";
import { Logo } from "@noomers/brand/Logo.tsx";
import { useSession } from "../lib/auth-client";
import { PRODUCT } from "../config";
import { navItemsFor } from "./nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

// Visible keyboard focus on nav items (Kumo's default is a faint background).
const FOCUS_RING = "focus-visible:ring-2 focus-visible:ring-kumo-brand focus-visible:ring-inset";

function SidebarNav() {
  const { data } = useSession();
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const items = navItemsFor(data?.user?.role);

  return (
    <>
      <Sidebar.Header>
        <Link
          variant="plain"
          render={<RouterLink to="/dashboard" />}
          aria-label={`${PRODUCT.name} dashboard`}
          className={cn("rounded-md px-1 text-kumo-default!", FOCUS_RING)}
        >
          <Logo size={24} wordmark={state === "expanded"} />
        </Link>
        {isMobile && <Sidebar.Close className="ml-auto" />}
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.Menu>
            {items.map((item) => {
              const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
              return (
                <Sidebar.MenuButton
                  key={item.to}
                  href={item.to}
                  icon={item.icon}
                  tooltip={item.label}
                  active={active}
                  aria-current={active ? "page" : undefined}
                  className={FOCUS_RING}
                  onClick={() => {
                    if (isMobile) setOpenMobile(false);
                  }}
                >
                  {item.label}
                </Sidebar.MenuButton>
              );
            })}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
    </>
  );
}

/** Sidebar toggle: opens the sheet on mobile, collapses to the icon rail on desktop. */
function NavTrigger() {
  const { isMobile, open, openMobile } = useSidebar();
  const expanded = isMobile ? openMobile : open;
  const label = isMobile
    ? expanded
      ? "Close navigation"
      : "Open navigation"
    : expanded
      ? "Collapse sidebar"
      : "Expand sidebar";
  return <Sidebar.Trigger aria-expanded={expanded} aria-label={label} />;
}

/** Page column. Inert while the mobile sheet is open so Tab stays in the sheet. */
function ShellContent({
  user,
  children,
}: {
  user?: { email: string; name?: string | null };
  children: ReactNode;
}) {
  const { isMobile, openMobile } = useSidebar();
  return (
    <div className="flex min-w-0 flex-1 flex-col" inert={isMobile && openMobile}>
      <header className="sticky top-0 z-10 border-b border-kumo-line bg-kumo-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-[58px] max-w-[1040px] items-center gap-2 px-4 sm:px-6">
          <NavTrigger />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            {user && <UserMenu user={user} />}
          </div>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1040px] px-4 py-8 outline-none sm:px-6"
      >
        {children}
      </main>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { data } = useSession();
  return (
    <Sidebar.Provider defaultOpen className="min-h-svh bg-kumo-canvas text-kumo-default">
      <Link
        href="#main"
        variant="plain"
        className="sr-only rounded-md bg-kumo-base px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </Link>
      {/* Only height/sticky here — position classes would override the
          `fixed` Kumo gives the mobile sheet and reserve its width again. */}
      <Sidebar className="h-svh md:sticky md:top-0">
        <SidebarNav />
      </Sidebar>
      <ShellContent user={data?.user}>{children}</ShellContent>
    </Sidebar.Provider>
  );
}
