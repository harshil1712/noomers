import { useRef, type PointerEvent } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button, Link, LinkButton, Text } from "@cloudflare/kumo";
import { CrewSprite } from "@noomers/brand/crew/CrewSprite";
import { useDocumentTitle } from "../lib/use-document-title";

function NotFound() {
  useDocumentTitle("Page not found");
  const wrapper = useRef<HTMLDivElement>(null);

  // Flashlight follows a mouse only (no pointer-follow on touch), via CSS
  // vars + transform so it stays on the compositor.
  const beam = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    wrapper.current?.style.setProperty("--light-x", `${e.clientX}px`);
    wrapper.current?.style.setProperty("--light-y", `${e.clientY}px`);
  };

  return (
    // The wrapper owns the background; `isolate` keeps the glow (z-0) above it
    // and the content (z-10) above the glow.
    <div
      ref={wrapper}
      onPointerMove={beam}
      className="relative isolate grid min-h-svh place-items-center overflow-hidden bg-kumo-canvas p-6 text-center text-kumo-default"
    >
      <div
        aria-hidden="true"
        className="crew-light"
        style={{
          left: 0,
          top: 0,
          transform:
            "translate3d(calc(var(--light-x, 50vw) - 50%), calc(var(--light-y, 40vh) - 50%), 0)",
        }}
      />
      <main className="relative z-10 flex max-w-sm flex-col items-center gap-4">
        <CrewSprite robot={1} color="--crew-2" size={56} />
        <Text variant="mono-secondary">404</Text>
        <Text variant="heading" size="lg" as="h1">
          Page not found
        </Text>
        <Text variant="secondary">
          The crew can't find that page either. It may have moved, or the link may be wrong.
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
        <CrewSprite size={56} />
        <Text variant="heading1" as="h1">
          Something broke
        </Text>
        <Text variant="secondary">The crew is on it. Try again, or head back home.</Text>
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
