// Theme persistence shared by apps/web and apps/site.
// The mode lives in localStorage under THEME_STORAGE_KEY and is applied as
// <html data-mode="light|dark">; tokens.css maps data-mode → color-scheme so
// every light-dark() token follows. "system" (or nothing saved) tracks
// prefers-color-scheme live.

export const THEME_STORAGE_KEY = "noomers-theme";

export type ThemeMode = "light" | "dark" | "system";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

/** Saved preference; "system" when nothing (or garbage) is stored, or on the server. */
export function readTheme(): ThemeMode {
  if (!isBrowser()) return "system";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system"; // storage blocked (privacy mode, sandboxed iframe)
  }
}

/** Concrete mode for a preference ("system" → current OS setting; "light" on the server). */
export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  if (!isBrowser()) return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

let unsubscribeSystem: (() => void) | null = null;

/**
 * Apply + persist a preference. Sets data-mode on <html>; for "system" it
 * removes the stored key and follows OS changes until another mode is applied.
 */
export function applyTheme(mode: ThemeMode): void {
  if (!isBrowser()) return;
  const root = document.documentElement;
  root.setAttribute("data-mode", resolveTheme(mode));

  try {
    if (mode === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* storage blocked — the mode still applies for this page view */
  }

  unsubscribeSystem?.();
  unsubscribeSystem = null;
  if (mode === "system") {
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => root.setAttribute("data-mode", mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    unsubscribeSystem = () => mq.removeEventListener("change", onChange);
  }
}

/**
 * Inline (blocking) <head> script: applies the saved/system mode before first
 * paint and follows OS changes while no explicit mode is saved. Keep it tiny
 * and dependency-free; it must stay in sync with readTheme/resolveTheme.
 *   Astro: <script is:inline set:html={THEME_BOOT_SCRIPT} />
 *   HTML/React: <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
 */
export const THEME_BOOT_SCRIPT = `(function(){var k="${THEME_STORAGE_KEY}",d=document.documentElement,m=window.matchMedia&&matchMedia("${DARK_QUERY}");function s(){try{return localStorage.getItem(k)}catch(e){return null}}function a(){var v=s();d.setAttribute("data-mode",v==="light"||v==="dark"?v:m&&m.matches?"dark":"light")}a();m&&m.addEventListener&&m.addEventListener("change",function(){var v=s();if(v!=="light"&&v!=="dark")a()})})();`;
