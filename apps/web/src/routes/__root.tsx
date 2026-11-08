import { useEffect } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Button, Link, LinkButton, Text } from "@cloudflare/kumo";
import { useDocumentTitle } from "../lib/use-document-title";
import { Logo } from "@noomers/brand/Logo.tsx";

function NotFound() {
  useDocumentTitle("Page not found");
  return (
    <div className="grid min-h-svh place-items-center bg-kumo-canvas p-6 text-center text-kumo-default">
      <main className="flex max-w-sm flex-col items-center gap-4">
        <Logo size={40} />
        <span className="mono-label">404</span>
        <Text variant="heading" size="lg" as="h1">
          Page not found
        </Text>
        <Text variant="secondary">
          That page doesn't exist. It may have moved, or the link may be wrong.
        </Text>
        <Link href="/">Back to the app</Link>
      </main>
    </div>
  );
}

function ErrorPage({
  error,
}: {
  error: unknown;
  info?: { componentStack: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("route error", error);
  }, [error]);
  return (
    <div className="min-h-screen grid place-items-center bg-kumo-canvas text-kumo-default text-center p-6">
      <div className="flex flex-col items-center gap-4">
        <Logo size={40} />
        <Text variant="heading1" as="h1">
          Something broke
        </Text>
        <Text variant="secondary">Something went wrong. Try again, or head back home.</Text>
        <div className="flex gap-3">
          <Button variant="primary" onClick={() => location.reload()}>
            Try again
          </Button>
          <LinkButton href="/" variant="secondary">
            Back home
          </LinkButton>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFound,
  errorComponent: ErrorPage,
});
