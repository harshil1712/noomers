import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  DropdownMenu,
  InputGroup,
  Loader,
  Table,
  Text,
} from "@cloudflare/kumo";
import {
  DotsThree,
  MagnifyingGlass,
  Prohibit,
  ShieldCheck,
  ShieldSlash,
  SignOut,
  WarningCircle,
} from "@phosphor-icons/react";
import { authClient, useSession } from "../../lib/auth-client";
import { authErrorMessage, type AuthErrorLike } from "../../lib/auth-errors";
import { toast } from "../../lib/toast";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { Empty } from "@cloudflare/kumo";
import { StatusBadge } from "../../components/status-badge";

export const Route = createFileRoute("/_authed/admin")({
  component: Admin,
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (session?.user?.role !== "admin") throw redirect({ to: "/dashboard" });
  },
});

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  banned?: boolean | null;
  emailVerified: boolean;
  createdAt: string | Date;
}

type ActionKind = "promote" | "demote" | "ban" | "unban" | "revoke";

interface ActionCopy {
  title: string;
  description: string;
  confirm: string;
  done: string;
  destructive?: boolean;
}

function copyFor(kind: ActionKind, email: string): ActionCopy {
  switch (kind) {
    case "promote":
      return {
        title: `Make ${email} an admin?`,
        description: "They'll be able to manage every user, including roles, bans and sessions.",
        confirm: "Make admin",
        done: "Role updated",
      };
    case "demote":
      return {
        title: `Remove admin from ${email}?`,
        description: "They'll lose access to the admin area.",
        confirm: "Remove admin",
        done: "Role updated",
      };
    case "ban":
      return {
        title: `Ban ${email}?`,
        description: "They're signed out everywhere and can't sign in again until you unban them.",
        confirm: "Ban user",
        done: "User banned",
        destructive: true,
      };
    case "unban":
      return {
        title: `Unban ${email}?`,
        description: "They'll be able to sign in again.",
        confirm: "Unban user",
        done: "User unbanned",
      };
    case "revoke":
      return {
        title: `Sign ${email} out everywhere?`,
        description: "All of their sessions end now. They can sign in again.",
        confirm: "Revoke sessions",
        done: "Sessions revoked",
      };
  }
}

function runAction(kind: ActionKind, userId: string): Promise<{ error?: AuthErrorLike | null }> {
  switch (kind) {
    case "promote":
      return authClient.admin.setRole({ userId, role: "admin" });
    case "demote":
      return authClient.admin.setRole({ userId, role: "user" });
    case "ban":
      return authClient.admin.banUser({ userId });
    case "unban":
      return authClient.admin.unbanUser({ userId });
    case "revoke":
      return authClient.admin.revokeUserSessions({ userId });
  }
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function Admin() {
  useDocumentTitle("Admin");
  const { data: session } = useSession();
  const selfId = session?.user?.id;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: ActionKind; user: AdminUser } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async (q: string) => {
    const id = ++latest.current;
    setLoading(true);
    const r = await authClient.admin.listUsers({
      query: { searchValue: q || undefined, searchField: "email", limit: 100 },
    });
    if (id !== latest.current) return; // a newer search superseded this one
    if (r.error) {
      setLoadError(authErrorMessage(r.error, "The user list didn't load."));
    } else {
      setLoadError(null);
      setUsers((r.data?.users as AdminUser[] | undefined) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(search), 200);
    return () => clearTimeout(t);
  }, [search, load]);

  const ask = (kind: ActionKind, user: AdminUser) => {
    setPending({ kind, user });
    setConfirmOpen(true);
  };

  const confirm = async () => {
    if (!pending) return;
    const copy = copyFor(pending.kind, pending.user.email);
    const r = await runAction(pending.kind, pending.user.id);
    if (r.error) toast.error(`${copy.confirm} failed`, authErrorMessage(r.error));
    else toast.success(copy.done, pending.user.email);
    await load(search);
  };

  const copy = pending ? copyFor(pending.kind, pending.user.email) : null;
  const firstLoad = loading && users.length === 0 && !loadError;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Admin"
        description="Users, roles, bans and sessions."
        actions={
          <InputGroup className="w-full sm:w-72">
            <InputGroup.Addon>
              <MagnifyingGlass aria-hidden />
            </InputGroup.Addon>
            <InputGroup.Input
              type="search"
              placeholder="Search by email"
              aria-label="Search users by email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {loading && !firstLoad && (
              <InputGroup.Addon align="end">
                <Loader aria-label="Searching" />
              </InputGroup.Addon>
            )}
          </InputGroup>
        }
      />

      {loadError ? (
        <Banner
          role="alert"
          variant="error"
          icon={<WarningCircle weight="fill" size={20} aria-hidden />}
          title="Couldn't load users"
          description={loadError}
          action={<Banner.Action onClick={() => void load(search)}>Try again</Banner.Action>}
        />
      ) : firstLoad ? (
        <div className="flex justify-center py-16">
          <Loader size="base" aria-label="Loading users" />
        </div>
      ) : users.length === 0 ? (
        <Empty
          title={search ? "No users match that search" : "No users yet"}
          description={
            search
              ? `Nothing found for "${search}". Check the spelling or search a different email.`
              : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-kumo-line" aria-busy={loading}>
          <div className="admin-scroll overflow-x-auto">
            <Table layout="fixed" className="min-w-[640px]">
              <colgroup>
                <col />
                <col className="w-24" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-16" />
              </colgroup>
              <Table.Header>
                <Table.Row>
                  <Table.Head>User</Table.Head>
                  <Table.Head>Role</Table.Head>
                  <Table.Head>Status</Table.Head>
                  <Table.Head>Joined</Table.Head>
                  <Table.Head>
                    <span className="sr-only">Actions</span>
                  </Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {users.map((u) => {
                  const isSelf = u.id === selfId;
                  const isAdmin = u.role === "admin";
                  return (
                    <Table.Row key={u.id}>
                      <Table.Cell>
                        <div className="flex min-w-0 flex-col">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium text-kumo-default">
                              {u.name || u.email}
                            </span>
                            {isSelf && <Badge variant="outline">You</Badge>}
                          </span>
                          {u.name && (
                            <Text variant="secondary" size="sm" truncate>
                              {u.email}
                            </Text>
                          )}
                        </div>
                      </Table.Cell>
                      <Table.Cell>{isAdmin ? "Admin" : "User"}</Table.Cell>
                      <Table.Cell>
                        <StatusBadge banned={u.banned} emailVerified={u.emailVerified} />
                      </Table.Cell>
                      <Table.Cell>{dateFormat.format(new Date(u.createdAt))}</Table.Cell>
                      <Table.Cell className="text-right">
                        <DropdownMenu>
                          <DropdownMenu.Trigger
                            disabled={isSelf}
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                icon={DotsThree}
                                aria-label={
                                  isSelf
                                    ? "You can't change your own account here"
                                    : `Actions for ${u.email}`
                                }
                              />
                            }
                          />
                          <DropdownMenu.Content align="end">
                            <DropdownMenu.Item
                              icon={isAdmin ? ShieldSlash : ShieldCheck}
                              onClick={() => ask(isAdmin ? "demote" : "promote", u)}
                            >
                              {isAdmin ? "Remove admin" : "Make admin"}
                            </DropdownMenu.Item>
                            <DropdownMenu.Item icon={SignOut} onClick={() => ask("revoke", u)}>
                              Revoke sessions
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator />
                            {u.banned ? (
                              <DropdownMenu.Item icon={Prohibit} onClick={() => ask("unban", u)}>
                                Unban user
                              </DropdownMenu.Item>
                            ) : (
                              <DropdownMenu.Item
                                icon={Prohibit}
                                variant="danger"
                                onClick={() => ask("ban", u)}
                              >
                                Ban user
                              </DropdownMenu.Item>
                            )}
                          </DropdownMenu.Content>
                        </DropdownMenu>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          </div>
        </div>
      )}

      {copy && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={copy.title}
          description={copy.description}
          confirmLabel={copy.confirm}
          variant={copy.destructive ? "destructive" : "primary"}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}
