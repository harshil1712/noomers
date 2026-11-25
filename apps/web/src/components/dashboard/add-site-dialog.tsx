import { useMemo, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button, Combobox, Dialog, Input } from "@cloudflare/kumo";
import { X } from "@phosphor-icons/react";
import { dashboardApi, DashboardApiError } from "../../lib/dashboard-api";
import { refreshSites, useSites } from "../../lib/use-sites";
import { TrackerSnippetBlock } from "./tracker-snippet-block";

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const standardZones = Intl.supportedValuesOf("timeZone");

export function displayZone(zone: string) {
  return ["Etc/UTC", "Etc/GMT", "GMT"].includes(zone) ? "UTC" : zone;
}

function zoneLabel(zone: string) {
  return zone.replaceAll("_", " ");
}

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
  const { sites } = useSites();
  const zones = useMemo(() => {
    const all = new Set([
      ...standardZones,
      displayZone(browserZone),
      ...(sites ?? []).map((site) => displayZone(site.timezone)),
    ]);
    all.delete("UTC");
    return ["UTC", ...Array.from(all).sort()];
  }, [sites]);
  return (
    <Combobox
      value={displayZone(value)}
      onValueChange={(v) => onChange((v as string) || value)}
      items={zones}
      itemToStringLabel={zoneLabel}
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
              {zoneLabel(tz)}
            </Combobox.Item>
          )}
        </Combobox.List>
      </Combobox.Content>
    </Combobox>
  );
}

/** "Add site" dialog — registers a site, then shows its tracker snippet. */
export function AddSiteDialog({
  trigger,
  onOpenDashboard,
}: {
  trigger?: ReactElement;
  onOpenDashboard?: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [timezone, setTimezone] = useState(displayZone(browserZone));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState<{ domain: string } | null>(null);

  const reset = (next: boolean) => {
    if (pending && !next) return;
    setOpen(next);
    if (!next) {
      // Refresh once the dialog closes — refreshing while it's still open
      // unmounts the parent empty state and drops the dialog.
      if (added) void refreshSites();
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
      setAdded({ domain: site.domain });
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
          <Dialog.Title className="min-w-0 break-words">
            {added ? `${added.domain} added` : "Add a site"}
          </Dialog.Title>
          <Dialog.Close
            disabled={pending}
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
              Paste this into the {"<head>"} of every page on {added.domain}. Visits show up in
              Realtime within seconds.
            </Dialog.Description>
            <div className="mt-3">
              <TrackerSnippetBlock domain={added.domain} />
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                variant="primary"
                onClick={() => {
                  reset(false);
                  onOpenDashboard?.();
                  void navigate({ to: "/dashboard", search: { site: added.domain } });
                }}
              >
                Open dashboard
              </Button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
            <Dialog.Description>
              Enter the domain you want to track, such as example.com.
            </Dialog.Description>
            <Input
              label="Domain"
              error={error || undefined}
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
                setError("");
              }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
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
            <div className="flex justify-end">
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
