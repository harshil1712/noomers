import { Button } from "@cloudflare/kumo";
import { CopySimple } from "@phosphor-icons/react";
import { trackerSnippet } from "../../lib/tracker-snippet";

export function TrackerSnippetBlock({ domain }: { domain: string }) {
  const snippet = trackerSnippet(domain);
  return (
    <div className="flex flex-col gap-2">
      <pre className="whitespace-pre-wrap break-all rounded-md bg-kumo-tint p-3 font-mono text-xs leading-relaxed">
        {snippet}
      </pre>
      <div>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Copy tracking snippet"
          icon={<CopySimple size={14} />}
          onClick={() => void navigator.clipboard.writeText(snippet)}
        >
          Copy snippet
        </Button>
      </div>
    </div>
  );
}
