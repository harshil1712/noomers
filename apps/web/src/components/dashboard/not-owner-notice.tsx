import { Empty, Text } from "@cloudflare/kumo";
import { LockSimple } from "@phosphor-icons/react";
import { useSession } from "../../lib/auth-client";

/** Shown when the signed-in account isn't the deployment owner (admin). */
export function NotOwnerNotice() {
  const { data } = useSession();
  return (
    <Empty
      icon={<LockSimple size={24} />}
      title="This account can't manage sites"
      description="Only the owner account can use the dashboard."
      contents={
        <Text variant="secondary" size="sm">
          Ask the owner for access. If this is your deployment, set <code>OWNER_ADMIN_EMAIL</code>{" "}
          to {data?.user?.email ?? "your email"}, then sign out and sign in again.
        </Text>
      }
    />
  );
}
