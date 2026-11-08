import { useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button, Code, Combobox, Dialog, Input, Text } from "@cloudflare/kumo";
import { X } from "@phosphor-icons/react";
import { dashboardApi, DashboardApiError } from "../../lib/dashboard-api";
import { refreshSites } from "../../lib/use-sites";

const TIMEZONES = Intl.supportedValuesOf("timeZone");

export function TimezonePicker({
  value,
  onChange,
  label,
  description,
}: {
  value: string;
  onChange: (tz: string) => void;
  label?: string;
  description?: string;
}) {
  return (
    <Combobox
      value={value}
      onValueChange={(v) => onChange((v as string) || value)}
      items={TIMEZONES}
      label={label}
      description={description}
    >
      <Combobox.TriggerValue className="w-full" />
      <Combobox.Content>
        <Combobox.Input placeholder="Search timezones" aria-label="Search timezones" />
        <Combobox.Empty>No matching timezone.</Combobox.Empty>
        <Combobox.List>
          {(tz: string) => (
            <Combobox.Item key={tz} value={tz}>
              {tz}
            </Combobox.Item>
          )}
        </Combobox.List>
      </Combobox.Content>
    </Combobox>
  );
}

/** "Add site" dialog — registers a site, then shows its tracker snippet. */
export function AddSiteDialog({ trigger }: { trigger?: ReactElement }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState<{ domain: string; snippet: string } | null>(null);

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setDomain("");
      setError("");
      setPending(false);
      setAdded(null);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const site = await dashboardApi.createSite(domain.trim(), timezone);
      setAdded({
        domain: site.domain,
        snippet: `<script defer src="${location.origin}/tracker.js" data-site-id="${site.domain}"></script>`,
      });
      void refreshSites();
    } catch (err) {
      if (err instanceof DashboardApiError && err.status === 403) {
        setError("Only the owner account can add sites.");
      } else {
        setError(err instanceof Error ? err.message : "Couldn't add the site.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={reset}>
      <Dialog.Trigger render={trigger ?? <Button variant="primary">Add site</Button>} />
      <Dialog className="p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <Dialog.Title>{added ? `${added.domain} added` : "Add a site"}</Dialog.Title>
          <Dialog.Close
            aria-label="Close"
            render={(props) => (
              <Button
                {...props}
                variant="ghost"
                size="sm"
                icon={<X size={16} />}
                aria-label="Close"
              />
            )}
          />
        </div>
        {added ? (
          <>
            <Dialog.Description>
              Add this snippet to the site to start collecting.
            </Dialog.Description>
            <div className="mt-3">
              <Code.Block code={added.snippet} lang="tsx" />
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                variant="primary"
                onClick={() => {
                  reset(false);
                  void navigate({ to: "/dashboard", search: { site: added.domain } });
                }}
              >
                Open dashboard
              </Button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
            <Dialog.Description>Register a site and start tracking it.</Dialog.Description>
            <Input
              label="Domain"
              error={error || undefined}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
              required
              autoFocus
            />
            <TimezonePicker
              value={timezone}
              onChange={setTimezone}
              label="Reporting timezone"
              description="Dates and charts are grouped in this timezone."
            />
            <div className="flex items-center justify-between gap-2">
              <Text variant="secondary" size="xs">
                Sites can also be managed via the Plausible-compatible Sites API.
              </Text>
              <Button variant="primary" type="submit" loading={pending}>
                Add site
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </Dialog.Root>
  );
}
