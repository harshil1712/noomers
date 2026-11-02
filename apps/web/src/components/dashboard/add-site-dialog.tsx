import { Button, Code, Dialog } from "@cloudflare/kumo";

/** "Add site" explainer — sites are registered through the Sites API. */
export function AddSiteDialog({ trigger }: { trigger?: React.ReactElement }) {
  const cmd = `curl -X POST ${location.origin}/api/v1/sites \\
  -H "Authorization: Bearer $SITES_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"domain": "example.com"}'`;
  return (
    <Dialog.Root>
      <Dialog.Trigger render={trigger ?? <Button variant="primary">Add site</Button>} />
      <Dialog className="p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <Dialog.Title>Add a site</Dialog.Title>
          <Dialog.Close aria-label="Close" />
        </div>
        <Dialog.Description>
          Sites are registered through the Sites API — there is no site-creation UI. Use your
          deployment&apos;s <Code code="SITES_API_TOKEN" /> as the Bearer token.
        </Dialog.Description>
        <div className="mt-3">
          <Code.Block code={cmd} lang="bash" />
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
