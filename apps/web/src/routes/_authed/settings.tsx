import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useState, type FormEvent, useRef } from "react";
import { Badge, Banner, Button, Input, Loader, Select, Tabs, Text } from "@cloudflare/kumo";
import { Copy, Plus } from "@phosphor-icons/react";
import { authClient, useSession } from "../../lib/auth-client";

import { SettingsSection } from "../../components/settings-section";
import { authErrorMessage, type AuthErrorLike } from "../../lib/auth-errors";
import { toast } from "../../lib/toast";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";
import { PasswordInput } from "../../components/password-input";
import { SensitiveInput } from "@cloudflare/kumo";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { FormError } from "../../components/form-error";
import { dashboardApi, DashboardApiError, type ApiKey } from "../../lib/dashboard-api";
import { refreshSites, useSites as useSharedSites } from "../../lib/use-sites";
import { AddSiteDialog, TimezonePicker } from "../../components/dashboard/add-site-dialog";

const sections = [
  { value: "account", label: "Account" },
  { value: "sites", label: "Sites" },
  { value: "keys", label: "API keys" },
] as const;
interface SettingsSearch {
  section?: "sites" | "keys";
}

export const Route = createFileRoute("/_authed/settings")({
  validateSearch: (search: { section?: string }): SettingsSearch => ({
    section: search.section === "sites" || search.section === "keys" ? search.section : undefined,
  }),
  component: Settings,
});

/** Whether this user signs in with a password (vs. Google only). null = loading. */
function useHasPassword(): boolean | null {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void authClient.listAccounts().then((r) => {
      // On failure assume a password exists — the server still verifies it.
      if (!cancelled)
        setHasPassword(r.data ? r.data.some((a) => a.providerId === "credential") : true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return hasPassword;
}

function Settings() {
  useDocumentTitle("Settings");
  const { section = "account" } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
      <PageHeader title="Settings" />
      <Tabs
        variant="underline"
        tabs={[...sections]}
        selectedValue={section}
        onValueChange={(value) =>
          void navigate({
            search: { section: value === "sites" || value === "keys" ? value : undefined },
          })
        }
      />
      {section === "sites" ? (
        <SitesSettings />
      ) : section === "keys" ? (
        <ApiKeysSection />
      ) : (
        <AccountSettings />
      )}
    </div>
  );
}

function AccountSettings() {
  const { data } = useSession();
  const hasPassword = useHasPassword();
  const user = data?.user;
  if (!user || hasPassword === null)
    return <Loader size="base" aria-label="Loading account settings" />;
  return (
    <>
      <ProfileSection key={user.id} name={user.name} email={user.email} />
      <PasswordSection hasPassword={hasPassword} />
      <SessionsSection />
      <DeleteAccountSection hasPassword={hasPassword} />
    </>
  );
}

function ProfileSection({ name: savedName, email }: { name: string; email: string }) {
  const formId = useId();
  const [name, setName] = useState(savedName);
  const [saving, setSaving] = useState(false);
  const unchanged = name.trim() === savedName.trim();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    const r = await authClient.updateUser({ name: name.trim() });
    setSaving(false);
    if (r.error) toast.error("Couldn't save your name", authErrorMessage(r.error));
    else toast.success("Name saved");
  };

  return (
    <SettingsSection
      title="Profile"
      footer={
        <Button
          variant="primary"
          type="submit"
          form={formId}
          loading={saving}
          disabled={unchanged || !name.trim()}
        >
          Save name
        </Button>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
        />
        <Input
          label="Email"
          description="Used to sign in. It can't be changed here."
          value={email}
          readOnly
          type="email"
        />
      </form>
    </SettingsSection>
  );
}

function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const formId = useId();
  const [current, setCurrent] = useState("");
  const currentRef = useRef<HTMLDivElement>(null);
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AuthErrorLike | null>(null);
  const [attempt, setAttempt] = useState(0);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const r = await authClient
      .changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true })
      .catch(() => ({ error: { message: "Network error. Check your connection and try again." } }));
    setSaving(false);
    if (r.error) {
      setError(r.error);
      setAttempt((n) => n + 1);
      return;
    }
    setCurrent("");
    setNext("");
    toast.success("Password changed", "Your other sessions have been signed out.");
  };

  const wrongCurrent = error?.code === "INVALID_PASSWORD";
  useEffect(() => {
    if (wrongCurrent) currentRef.current?.querySelector("input")?.focus();
  }, [wrongCurrent, attempt]);
  const badNew = error?.code === "PASSWORD_TOO_SHORT" || error?.code === "PASSWORD_TOO_LONG";

  if (!hasPassword) {
    return (
      <SettingsSection
        title="Password"
        description="You sign in with Google, so there's no password to change."
      />
    );
  }

  return (
    <SettingsSection
      title="Password"
      description="Changing your password signs you out on every other device."
      footer={
        <Button variant="primary" type="submit" form={formId} loading={saving}>
          Change password
        </Button>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div ref={currentRef}>
          <PasswordInput
            label="Current password"
            value={current}
            onValueChange={setCurrent}
            autoComplete="current-password"
            error={wrongCurrent ? "That password isn't right." : undefined}
          />
        </div>
        <PasswordInput
          label="New password"
          description="At least 8 characters"
          value={next}
          onValueChange={setNext}
          autoComplete="new-password"
          minLength={8}
          error={badNew ? authErrorMessage(error) : undefined}
        />
        {!wrongCurrent && !badNew && (
          <FormError
            message={error ? authErrorMessage(error, "Couldn't change your password.") : null}
            attempt={attempt}
          />
        )}
      </form>
    </SettingsSection>
  );
}

function SessionsSection() {
  const revoke = async () => {
    const r = await authClient.revokeOtherSessions();
    if (r.error) {
      toast.error("Couldn't sign out other sessions", authErrorMessage(r.error));
      return false;
    }
    toast.success("Other sessions signed out");
  };

  return (
    <SettingsSection
      title="Sessions"
      description="Sign out of all your other sessions. This session stays active."
      footer={
        <ConfirmDialog
          title="Sign out other sessions?"
          description="Every other browser and device signed in to your account is signed out now. You stay signed in here."
          confirmLabel="Sign out others"
          onConfirm={revoke}
          trigger={<Button variant="secondary">Sign out other sessions</Button>}
        />
      }
    />
  );
}

function DeleteAccountSection({ hasPassword }: { hasPassword: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const remove = async () => {
    setError(null);
    const r = await authClient.deleteUser({
      password: hasPassword ? password : undefined,
      callbackURL: "/sign-in",
    });
    if (r.error) {
      setError(authErrorMessage(r.error, "Couldn't delete your account."));
      setAttempt((n) => n + 1);
      return false;
    }
    // Full reload: the session cookie is gone and every cached read with it.
    location.assign("/sign-in?notice=account-deleted");
  };

  return (
    <SettingsSection
      title="Delete account"
      description="Permanently delete your account and sign-in data. This can't be undone."
      footer={
        <ConfirmDialog
          title="Delete your account?"
          description="This permanently removes your login and sessions. Registered sites and their analytics stay in this installation."
          confirmLabel="Delete account"
          variant="destructive"
          onConfirm={remove}
          confirmDisabled={hasPassword && !password}
          onOpenChange={(open) => {
            if (!open) {
              setPassword("");
              setError(null);
            }
          }}
          trigger={<Button variant="secondary-destructive">Delete account</Button>}
        >
          {hasPassword ? (
            <PasswordInput
              label="Enter your password to confirm"
              value={password}
              onValueChange={setPassword}
              autoComplete="current-password"
              invalid={Boolean(error)}
            />
          ) : (
            <Text variant="secondary" size="sm">
              If you signed in more than a day ago, sign out and back in first.
            </Text>
          )}
          <FormError message={error} attempt={attempt} />
        </ConfirmDialog>
      }
    />
  );
}

function SitesSettings() {
  const { sites, error: loadError, forbidden } = useSharedSites();
  const [timezones, setTimezones] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const saveTimezone = async (domain: string) => {
    const timezone = timezones[domain];
    setBusy(domain);
    try {
      await dashboardApi.updateSite(domain, timezone);
      await refreshSites();
      setTimezones((drafts) => {
        if (drafts[domain] !== timezone) return drafts;
        const next = { ...drafts };
        delete next[domain];
        return next;
      });
      toast.success("Timezone saved", domain);
    } catch (e) {
      toast.error("Couldn't save timezone", e instanceof Error ? e.message : domain);
    } finally {
      setBusy(null);
    }
  };

  const deleteSite = async (domain: string) => {
    try {
      await dashboardApi.deleteSite(domain);
      toast.success(`${domain} deleted`, "Collection has stopped.");
      void refreshSites();
    } catch (e) {
      toast.error("Couldn't delete the site", e instanceof Error ? e.message : domain);
      return false;
    }
  };

  return (
    <SettingsSection
      title="Sites"
      description="The reporting timezone determines when each day starts in a site’s analytics."
      footer={sites && !forbidden ? <AddSiteDialog /> : undefined}
    >
      {forbidden ? (
        <Text variant="secondary" size="sm">
          Only the owner account can manage sites.
        </Text>
      ) : loadError ? (
        <Banner
          variant="error"
          title="Couldn’t load your sites"
          action={
            <Button variant="secondary" onClick={() => void refreshSites()}>
              Retry
            </Button>
          }
        />
      ) : sites === null ? (
        <Loader size="sm" aria-label="Loading sites" />
      ) : sites.length === 0 ? (
        <Text variant="secondary" size="sm">
          No sites yet.
        </Text>
      ) : (
        <ul className="flex flex-col gap-4">
          {sites.map((site) => (
            <li
              key={site.domain}
              className="flex min-w-0 flex-wrap items-end gap-3 border-b border-kumo-line pb-4 last:border-0 last:pb-0"
            >
              <h3 className="w-full break-all text-sm font-semibold text-kumo-default">
                {site.domain}
              </h3>
              <div className="w-full sm:w-56">
                <TimezonePicker
                  label="Reporting timezone"
                  value={timezones[site.domain] ?? site.timezone}
                  onChange={(tz) => setTimezones((t) => ({ ...t, [site.domain]: tz }))}
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={busy === site.domain}
                disabled={
                  busy !== null || (timezones[site.domain] ?? site.timezone) === site.timezone
                }
                onClick={() => void saveTimezone(site.domain)}
              >
                Save timezone
              </Button>
              <ConfirmDialog
                title={`Delete ${site.domain}?`}
                description="Collection stops immediately and this domain can never be added again. Its stored history stays in your Basin storage until you erase it with the erasure command in docs/deploy.md."
                confirmLabel="Delete site"
                variant="destructive"
                confirmDisabled={confirmText !== site.domain}
                onOpenChange={(open) => {
                  if (!open) setConfirmText("");
                }}
                onConfirm={() => deleteSite(site.domain)}
                trigger={
                  <Button variant="secondary-destructive" size="sm">
                    Delete site
                  </Button>
                }
              >
                <Input
                  label={`Type ${site.domain} to confirm`}
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={site.domain}
                />
              </ConfirmDialog>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

/** Long unbroken key names would overflow labels, dialog titles and toasts. */
const shortName = (name: string) => (name.length > 24 ? `${name.slice(0, 23)}…` : name);

function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiKey["scope"]>("stats");
  const [creating, setCreating] = useState(false);
  const [reveal, setReveal] = useState<{ name: string; key: string } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await dashboardApi.apiKeys();
        if (!cancelled) setKeys(r.api_keys);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DashboardApiError && e.status === 403) setForbidden(true);
        else setError("Couldn't load API keys.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreating(true);
    try {
      const created = await dashboardApi.createApiKey(name.trim(), scope);
      setReveal({ name: created.name, key: created.key });
      setName("");
      setScope("stats");
      setNonce((n) => n + 1);
      toast.success("API key created", shortName(created.name));
    } catch (err) {
      toast.error("Couldn't create the API key", err instanceof Error ? err.message : undefined);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (key: ApiKey) => {
    try {
      await dashboardApi.revokeApiKey(key.id);
      setNonce((n) => n + 1);
      toast.success("API key revoked", shortName(key.name));
    } catch (err) {
      toast.error("Couldn't revoke the API key", err instanceof Error ? err.message : undefined);
      return false;
    }
  };

  const copy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast.success("API key copied");
    } catch {
      toast.error("Couldn't copy the key", "Select it and copy it manually.");
    }
  };

  return (
    <SettingsSection
      title="API keys"
      description="Read-only keys can query your analytics. Full-access keys can also manage sites, goals and custom properties."
    >
      {reveal && (
        <>
          <Banner
            variant="alert"
            title="Copy this key now. You won't be able to see it again."
            className="mb-4"
          />
          <div className="mb-4 flex items-end gap-2">
            <div className="min-w-0 grow">
              <SensitiveInput
                label={`Key for ${shortName(reveal.name)}`}
                value={reveal.key}
                readOnly
              />
            </div>
            <Button
              variant="secondary"
              aria-label="Copy API key"
              onClick={() => void copy(reveal.key)}
            >
              <Copy size={16} />
            </Button>
            <Button variant="primary" onClick={() => setReveal(null)}>
              Done
            </Button>
          </div>
        </>
      )}
      {forbidden ? (
        <Text variant="secondary" size="sm">
          Only the owner account can manage API keys.
        </Text>
      ) : error ? (
        <Banner
          variant="error"
          title={error}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setError(null);
                setNonce((n) => n + 1);
              }}
            >
              Retry
            </Button>
          }
        />
      ) : keys === null ? (
        <Loader size="sm" aria-label="Loading API keys" />
      ) : (
        <>
          {keys.length === 0 ? (
            <Text variant="secondary" size="sm">
              No API keys yet.
            </Text>
          ) : (
            <ul className="flex flex-col gap-4">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex min-w-0 flex-wrap items-end gap-3 border-b border-kumo-line pb-4 last:border-0 last:pb-0"
                >
                  <Text truncate>{key.name}</Text>
                  <Badge variant={key.scope === "sites" ? "primary" : "secondary"}>
                    {key.scope === "sites" ? "Full access" : "Read-only"}
                  </Badge>
                  <code className="text-sm text-kumo-subtle">{key.prefix}…</code>
                  <Text variant="secondary" size="sm">
                    Created {new Date(key.created_at).toLocaleDateString()}
                  </Text>
                  <Text variant="secondary" size="sm">
                    Last used{" "}
                    {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}
                  </Text>
                  {key.revoked_at ? (
                    <Badge variant="neutral">Revoked</Badge>
                  ) : (
                    <ConfirmDialog
                      title={`Revoke ${shortName(key.name)}?`}
                      description="Integrations using this key stop working immediately. This can't be undone."
                      confirmLabel="Revoke key"
                      variant="destructive"
                      onConfirm={() => revoke(key)}
                      trigger={
                        <Button variant="secondary-destructive" size="sm">
                          Revoke
                        </Button>
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={(e) => void submit(e)} className="mt-4 flex flex-wrap items-end gap-3">
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              required
              placeholder="e.g. Grafana"
            />
            <Select
              label="Access"
              value={scope}
              onValueChange={(v) => setScope(v ?? "stats")}
              items={{ stats: "Read-only", sites: "Full access" }}
            />
            <Button variant="primary" type="submit" loading={creating} disabled={!name.trim()}>
              <Plus size={16} /> Create key
            </Button>
          </form>
        </>
      )}
    </SettingsSection>
  );
}
