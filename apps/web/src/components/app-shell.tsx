import { useEffect, useState, type ReactNode } from "react";
import { CommandPalette, Code, Dialog, Link, Sidebar, useSidebar } from "@cloudflare/kumo";
import { Link as RouterLink, useLocation, useNavigate } from "@tanstack/react-router";
import { Logo } from "@noomers/brand/Logo.tsx";
import { Gear, Globe, Plus, ShieldCheck } from "@phosphor-icons/react";
import { useSession } from "../lib/auth-client";
import { dashboardApi } from "../lib/dashboard-api";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

const FOCUS_RING = "focus-visible:ring-2 focus-visible:ring-kumo-brand focus-visible:ring-inset";

function useSites() {
  const [sites, setSites] = useState<string[]>([]);
  useEffect(() => {
    dashboardApi
      .sites()
      .then((r) => setSites(r.sites))
      .catch(() => setSites([]));
  }, []);
  return sites;
}

function AddSiteDialog() {
  const cmd = `curl -X POST ${location.origin}/api/v1/sites \\
  -H "Authorization: Bearer $SITES_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"domain": "example.com"}'`;
  return (
    <Dialog.Root>
      <Dialog.Trigger
        render={
          <Sidebar.MenuButton icon={Plus} tooltip="Add site" className={FOCUS_RING}>
            Add site
          </Sidebar.MenuButton>
        }
      />
      <Dialog className="p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <Dialog.Title>Add a site</Dialog.Title>
          <Dialog.Close aria-label="Close" />
        </div>
        <Dialog.Description>
          Sites are registered through the Sites API — there is no site-creation UI. Use your
          deployment&apos;s <Code code="SITES_API_TOKEN" /> as the Bearer token.
        </Dialog.Description>
        <div className="mt-3">
          <Code.Block code={cmd} lang="bash" />
        </div>
      </Dialog>
    </Dialog.Root>
  );
}

function SiteCommands({ sites }: { sites: string[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { data } = useSession();
  const isAdmin = data?.user?.role === "admin";

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
    ...(isAdmin
      ? [
          {
            id: "admin",
            title: "Admin",
            icon: <ShieldCheck size={16} />,
            run: () => void navigate({ to: "/admin" }),
          },
        ]
      : []),
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
  const isAdmin = data?.user?.role === "admin";
  const activeSite = new URLSearchParams(location.search).get("site");

  return (
    <>
      <Sidebar.Header>
        <Link
          variant="plain"
          render={<RouterLink to="/dashboard" />}
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
            <AddSiteDialog />
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
      <Sidebar.Footer>
        <Sidebar.Menu>
          <Sidebar.MenuButton
            icon={Gear}
            active={pathname.startsWith("/settings")}
            tooltip="Settings"
            className={FOCUS_RING}
            onClick={() => void navigate({ to: "/settings" })}
          >
            Settings
          </Sidebar.MenuButton>
          {isAdmin && (
            <Sidebar.MenuButton
              icon={ShieldCheck}
              active={pathname.startsWith("/admin")}
              tooltip="Admin"
              className={FOCUS_RING}
              onClick={() => void navigate({ to: "/admin" })}
            >
              Admin
            </Sidebar.MenuButton>
          )}
        </Sidebar.Menu>
        <div className="flex min-w-0 items-center justify-between gap-2 px-1 pt-2">
          {data?.user && (
            <div className="min-w-0 flex-1">
              <UserMenu user={data.user} />
            </div>
          )}
          <ThemeToggle />
        </div>
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
      <main className="flex-1 min-w-0 overflow-y-auto bg-kumo-canvas">{children}</main>
      <SiteCommands sites={sites} />
    </Sidebar.Provider>
  );
}
