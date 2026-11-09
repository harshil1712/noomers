import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useState, type FormEvent, useRef } from "react";
import { Button, Input, Loader, Text } from "@cloudflare/kumo";
import { authClient, useSession } from "../../lib/auth-client";

/** Settings card over Kumo LayerCard: title/description/body in Primary,
   optional actions row in Secondary. */
function SettingsSection({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: import("react").ReactNode;
  children?: import("react").ReactNode;
  footer?: import("react").ReactNode;
}) {
  return (
    <LayerCard>
      <LayerCard.Primary>
        <Text variant="heading3" as="h2">
          {title}
        </Text>
        {description && (
          <Text variant="secondary" size="sm">
            {description}
          </Text>
        )}
        {children}
      </LayerCard.Primary>
      {footer && <LayerCard.Secondary>{footer}</LayerCard.Secondary>}
    </LayerCard>
  );
}
import { authErrorMessage, type AuthErrorLike } from "../../lib/auth-errors";
import { toast } from "../../lib/toast";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";
import { LayerCard, SensitiveInput } from "@cloudflare/kumo";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { FormError } from "../../components/form-error";
import { dashboardApi } from "../../lib/dashboard-api";
import { refreshSites, useSites as useSharedSites } from "../../lib/use-sites";
import { TimezonePicker } from "../../components/dashboard/add-site-dialog";

export const Route = createFileRoute("/_authed/settings")({ component: Settings });

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
  const { data } = useSession();
  const hasPassword = useHasPassword();
  const user = data?.user;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <PageHeader crumbs={[{ label: "Sites", to: "/" }, { label: "Settings" }]} title="Settings" />
      {!user || hasPassword === null ? (
        <div className="flex justify-center py-12">
          <Loader size="base" aria-label="Loading settings" />
        </div>
      ) : (
        <>
          {/* key: re-seed the form if the signed-in user changes */}
          <ProfileSection key={user.id} name={user.name} email={user.email} />
          <PasswordSection hasPassword={hasPassword} />
          <SessionsSection />
          <SitesSettings />
          <DeleteAccountSection hasPassword={hasPassword} />
        </>
      )}
    </div>
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
        <Button variant="primary" type="submit" form={formId} loading={saving} disabled={unchanged}>
          Save
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

  if (!hasPassword) {
    return (
      <SettingsSection
        title="Password"
        description="You sign in with Google, so there's no password to change."
      />
    );
  }

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
          <SensitiveInput
            label="Current password"
            value={current}
            onValueChange={setCurrent}
            autoComplete="current-password"
            error={wrongCurrent ? "That password isn't right." : undefined}
          />
        </div>
        <SensitiveInput
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
      description="Signed in somewhere you don't recognise? Sign out everywhere except this device."
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
          description="Your account, sessions and sign-in methods are deleted immediately. This can't be undone."
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
            <SensitiveInput
              label="Enter your password to confirm"
              value={password}
              onValueChange={setPassword}
              autoComplete="current-password"
              variant={error ? "error" : "default"}
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
  const navigate = useNavigate();
  const { sites, error: loadError, forbidden } = useSharedSites();
  const [error, setError] = useState<string | null>(null);
  const [timezones, setTimezones] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (loadError) setError("Couldn't load your sites.");
    if (sites) setTimezones(Object.fromEntries(sites.map((d) => [d.domain, d.timezone])));
  }, [sites, loadError]);

  const saveTimezone = async (domain: string) => {
    setBusy(domain);
    try {
      await dashboardApi.updateSite(domain, timezones[domain]);
      void refreshSites();
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
      const remaining = (sites ?? []).filter((s) => s.domain !== domain);
      const active = new URLSearchParams(location.search).get("site");
      if (active === domain || remaining.length === 0) {
        void navigate({ to: "/dashboard", search: { site: remaining[0]?.domain } });
      }
    } catch (e) {
      toast.error("Couldn't delete the site", e instanceof Error ? e.message : domain);
      return false;
    }
  };

  return (
    <SettingsSection
      title="Sites"
      description="Manage your tracked sites. Deleting a site is permanent."
    >
      {error && !forbidden && <FormError message={error} attempt={0} />}
      {forbidden ? (
        <Text variant="secondary" size="sm">
          Only the owner account can manage sites.
        </Text>
      ) : loadError ? null : sites === null ? (
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
              className="flex flex-wrap items-center gap-3 border-b border-kumo-line pb-4 last:border-0 last:pb-0"
            >
              <Text>{site.domain}</Text>
              <div className="w-56">
                <TimezonePicker
                  label={`Reporting timezone for ${site.domain}`}
                  value={timezones[site.domain] ?? site.timezone}
                  onChange={(tz) => setTimezones((t) => ({ ...t, [site.domain]: tz }))}
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={busy === site.domain}
                disabled={timezones[site.domain] === site.timezone}
                onClick={() => void saveTimezone(site.domain)}
              >
                Save
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
                    Delete
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
