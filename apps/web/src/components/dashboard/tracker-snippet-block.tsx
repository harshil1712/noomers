import { Button } from "@cloudflare/kumo";
import { CopySimple } from "@phosphor-icons/react";
import { trackerSnippet } from "../../lib/tracker-snippet";
import { toast } from "../../lib/toast";

export function TrackerSnippetBlock({ domain }: { domain: string }) {
  const snippet = trackerSnippet(domain);
  const copy = () =>
    navigator.clipboard.writeText(snippet).then(
      () => toast.success("Snippet copied"),
      () => toast.error("Couldn't copy", "Select the snippet and copy it manually."),
    );
  return (
    <div className="flex flex-col gap-2">
      <pre className="whitespace-pre-wrap break-all rounded-md bg-kumo-tint p-3 font-mono text-xs leading-relaxed">
        {snippet}
      </pre>
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={<CopySimple size={14} />}
          onClick={() => void copy()}
        >
          Copy snippet
        </Button>
      </div>
    </div>
  );
}
