import { Button, DropdownMenu } from "@cloudflare/kumo";
import { CaretDown, Gear, SignOut } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { signOut } from "../lib/auth-client";
import { authErrorMessage } from "../lib/auth-errors";
import { toast } from "../lib/toast";

/** Header account menu: who's signed in, Settings, Sign out. */
export function UserMenu({ user }: { user: { email: string; name?: string | null } }) {
  const navigate = useNavigate();
  const initial = (user.name?.trim() || user.email || "?")[0].toUpperCase();

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
            aria-label="Account menu"
            className="gap-2 rounded-full pr-2 pl-1"
          >
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-full bg-kumo-brand text-xs font-semibold text-(--brand-ink)"
            >
              {initial}
            </span>
            <span className="hidden max-w-48 truncate text-sm sm:inline">{user.email}</span>
            <CaretDown size={12} aria-hidden />
          </Button>
        }
      />
      <DropdownMenu.Content align="end">
        <DropdownMenu.Group>
          <DropdownMenu.Label>
            <span className="block truncate font-medium text-kumo-default">
              {user.name || user.email}
            </span>
            {user.name && <span className="block truncate text-kumo-subtle">{user.email}</span>}
          </DropdownMenu.Label>
        </DropdownMenu.Group>
        <DropdownMenu.Separator />
        <DropdownMenu.Item icon={Gear} onClick={() => void navigate({ to: "/settings" })}>
          Settings
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={SignOut} onClick={() => void handleSignOut()}>
          Sign out
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
