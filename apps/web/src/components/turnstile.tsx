import { useEffect, useRef } from "react";
import { usePublicConfig } from "../lib/public-config";

interface TurnstileOptions {
  sitekey: string;
  callback: (t: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "flexible" | "compact";
}

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: TurnstileOptions): string;
      reset(id: string): void;
      remove(id: string): void;
    };
  }
}

let apiPromise: Promise<void> | null = null;

function loadApi(): Promise<void> {
  apiPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(s);
  });
  return apiPromise;
}

function currentTheme(): "light" | "dark" | "auto" {
  const mode = document.documentElement.getAttribute("data-mode");
  return mode === "light" || mode === "dark" ? mode : "auto";
}

/**
 * Managed-mode Turnstile widget. onToken fires with a single-use token;
 * remount (change `key`) after a failed submit — tokens are single-use.
 * Fills its container (`size: "flexible"`) and reserves its height so the
 * form doesn't jump when the iframe loads.
 */
export function TurnstileWidget({ onToken }: { onToken: (token: string | null) => void }) {
  const { turnstileSiteKey } = usePublicConfig();
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!turnstileSiteKey || !elRef.current) return;
    let cancelled = false;
    let widgetId: string | null = null;
    loadApi()
      .then(() => {
        if (cancelled || !elRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(elRef.current, {
          sitekey: turnstileSiteKey,
          callback: onToken,
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
          theme: currentTheme(),
          size: "flexible",
        });
      })
      .catch(() => {
        // Script blocked or offline: drop the cached rejection so a remount
        // can retry; the server rejects the captcha-less submit anyway.
        apiPromise = null;
      });
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [turnstileSiteKey, onToken]);

  if (!turnstileSiteKey) return null;
  return <div ref={elRef} className="min-h-[65px] w-full" />;
}
