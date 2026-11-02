import { createFileRoute, redirect } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    throw redirect({ to: session ? "/dashboard" : "/sign-in" });
  },
});
