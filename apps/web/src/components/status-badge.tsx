import { Badge } from "@cloudflare/kumo";

/** Account status for the admin users table. */
export function StatusBadge({
  banned,
  emailVerified,
}: {
  banned?: boolean | null;
  emailVerified: boolean;
}) {
  if (banned) return <Badge variant="error">Banned</Badge>;
  if (!emailVerified) return <Badge variant="secondary">Unverified</Badge>;
  return <Badge variant="success">Active</Badge>;
}
