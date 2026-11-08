import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client";
import AppShell from "../components/app-shell";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (!session?.user) throw redirect({ to: "/sign-in", search: { notice: undefined } });
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
