import { forwardRef, type MouseEvent } from "react";
import type { LinkComponentProps } from "@cloudflare/kumo";
import { useRouter } from "@tanstack/react-router";

function isPlainLeftClick(e: MouseEvent<HTMLAnchorElement>) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * Kumo `LinkProvider` adapter: every Kumo `Link`, `LinkButton` and
 * `Sidebar.MenuButton href` renders a real `<a href>` (middle-click and
 * open-in-new-tab work) and same-app paths navigate client-side through
 * TanStack Router.
 */
export const RouterAnchor = forwardRef<HTMLAnchorElement, LinkComponentProps>(function RouterAnchor(
  { href, to, onClick, target, ...rest },
  ref,
) {
  const router = useRouter();
  const url = href ?? to;
  return (
    <a
      ref={ref}
      href={url}
      target={target}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !url || !url.startsWith("/") || url.startsWith("//")) return;
        if ((target && target !== "_self") || !isPlainLeftClick(e)) return;
        e.preventDefault();
        router.history.push(url);
      }}
    />
  );
});
