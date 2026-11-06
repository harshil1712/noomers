import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CommandPalette, Link, Sidebar, useSidebar } from "@cloudflare/kumo";
import { Link as RouterLink, useLocation, useNavigate } from "@tanstack/react-router";
import { Logo } from "@noomers/brand/Logo.tsx";
import { Gear, Globe, Plus, SquaresFour } from "@phosphor-icons/react";
import { useSession } from "../lib/auth-client";
import { ThemeToggle } from "./theme-toggle";
import { AddSiteDialog } from "./dashboard/add-site-dialog";
import { UserMenu } from "./user-menu";
import { useSites as useSharedSites } from "../lib/use-sites";

const FOCUS_RING = "focus-visible:ring-2 focus-visible:ring-kumo-brand focus-visible:ring-inset";

function useSites() {
  const { sites } = useSharedSites();
  return useMemo(() => (sites ?? []).map((s) => s.domain), [sites]);
}

function SiteCommands({ sites }: { sites: string[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (domain: string) => void navigate({ to: "/dashboard", search: { site: domain } });
  const items = [
    {
      id: "all-sites",
      title: "All sites",
      icon: <SquaresFour size={16} />,
      run: () => void navigate({ to: "/" }),
    },
    ...sites.map((domain) => ({
      id: `site-${domain}`,
      title: domain,
      icon: <Globe size={16} />,
      run: () => go(domain),
    })),
    {
      id: "settings",
      title: "Settings",
      icon: <Gear size={16} />,
      run: () => void navigate({ to: "/settings" }),
    },
  ];
  const filtered = items.filter((i) => i.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <CommandPalette.Root
      open={open}
      onOpenChange={setOpen}
      items={filtered}
      value={search}
      onValueChange={setSearch}
      itemToStringValue={(i) => i.title}
      onSelect={(item) => {
        item.run();
        setOpen(false);
      }}
    >
      <CommandPalette.Input placeholder="Switch site or jump to a page…" />
      <CommandPalette.List>
        <CommandPalette.Group items={filtered}>
          <CommandPalette.Items>
            {(item) => (
              <CommandPalette.Item key={item.id} value={item} onClick={item.run}>
                <span className="flex items-center gap-3">
                  <span className="text-kumo-subtle">{item.icon}</span>
                  <span>{item.title}</span>
                </span>
              </CommandPalette.Item>
            )}
          </CommandPalette.Items>
        </CommandPalette.Group>
      </CommandPalette.List>
    </CommandPalette.Root>
  );
}

function SidebarNav() {
  const { data } = useSession();
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const sites = useSites();
  const activeSite = new URLSearchParams(location.search).get("site");

  return (
    <>
      <Sidebar.Header>
        <Link
          variant="plain"
          render={<RouterLink to="/" />}
          aria-label="noomers dashboard"
          className={`rounded-md px-1 text-kumo-default! ${FOCUS_RING}`}
        >
          <Logo />
        </Link>
        {isMobile && <Sidebar.Close className="ml-auto" />}
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.GroupLabel>Sites</Sidebar.GroupLabel>
          <Sidebar.Menu>
            <Sidebar.MenuButton
              icon={SquaresFour}
              active={pathname === "/"}
              tooltip="All sites"
              className={FOCUS_RING}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                void navigate({ to: "/" });
              }}
            >
              All sites
            </Sidebar.MenuButton>
            {sites.map((domain) => (
              <Sidebar.MenuButton
                key={domain}
                icon={Globe}
                active={activeSite === domain}
                tooltip={domain}
                className={FOCUS_RING}
                onClick={() => {
                  if (isMobile) setOpenMobile(false);
                  void navigate({ to: "/dashboard", search: { site: domain } });
                }}
              >
                {domain}
              </Sidebar.MenuButton>
            ))}
            <AddSiteDialog
              trigger={
                <Sidebar.MenuButton icon={Plus} tooltip="Add site" className={FOCUS_RING}>
                  Add site
                </Sidebar.MenuButton>
              }
            />
          </Sidebar.Menu>
        </Sidebar.Group>
        <Sidebar.Group className="mt-auto">
          <Sidebar.Menu></Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
      <Sidebar.Footer className="justify-between gap-2">
        {data?.user && (
          <div className="min-w-0 flex-1 group-data-[state=collapsed]/sidebar:hidden">
            <UserMenu user={data.user} />
          </div>
        )}
        <ThemeToggle />
      </Sidebar.Footer>
    </>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const sites = useSites();
  return (
    <Sidebar.Provider collapsible="icon" className="h-dvh">
      <Sidebar>
        <SidebarNav />
      </Sidebar>
      <div className="fixed left-3 top-3 z-30 md:hidden">
        <Sidebar.Trigger />
      </div>
      <main className="flex-1 min-w-0 overflow-y-auto bg-kumo-canvas pt-12 md:pt-0">
        {children}
      </main>
      <SiteCommands sites={sites} />
    </Sidebar.Provider>
  );
}
