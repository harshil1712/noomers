import { Button, DropdownMenu } from "@cloudflare/kumo";
import { CaretDown, SignOut } from "@phosphor-icons/react";
import { signOut } from "../lib/auth-client";
import { authErrorMessage } from "../lib/auth-errors";
import { toast } from "../lib/toast";

export function UserMenu({ user }: { user: { name?: string | null } }) {
  const displayName = user.name?.trim() || "Account";
  const initial = displayName[0].toUpperCase();

  const handleSignOut = async () => {
    const r = await signOut();
    if (r.error) {
      toast.error("Couldn't sign out", authErrorMessage(r.error));
      return;
    }
    // Full reload clears every cached session read.
    location.assign("/sign-in");
  };

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={
          <Button
            variant="ghost"
            aria-label={`Account menu for ${displayName}`}
            className="w-full min-w-0 justify-start gap-2 pr-2 pl-1"
          >
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-full bg-kumo-brand text-xs font-semibold text-(--brand-ink)"
            >
              {initial}
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-sm">{displayName}</span>
            <CaretDown size={12} aria-hidden className="shrink-0" />
          </Button>
        }
      />
      <DropdownMenu.Content align="end">
        <DropdownMenu.Group>
          <DropdownMenu.Label>{displayName}</DropdownMenu.Label>
        </DropdownMenu.Group>
        <DropdownMenu.Separator />
        <DropdownMenu.Item icon={SignOut} onClick={() => void handleSignOut()}>
          Sign out
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
