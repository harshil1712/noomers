import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "../../lib/auth-client";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";
import { CrewEmpty } from "../../components/crew-empty";

export const Route = createFileRoute("/_authed/dashboard")({ component: Dashboard });

function Dashboard() {
  useDocumentTitle("Dashboard");
  const { data } = useSession();
  const firstName = data?.user?.name?.trim().split(/\s+/)[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={firstName ? `Welcome, ${firstName}` : "Welcome"} />
      <CrewEmpty
        title="Nothing here yet"
        description="Your work will show up here."
      />
    </div>
  );
}
