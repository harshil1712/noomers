import { useEffect, useState } from "react";
import { Button } from "@cloudflare/kumo";
import { Moon, Sun } from "@phosphor-icons/react";
import { applyTheme, readTheme, resolveTheme } from "@noomers/brand/theme";

/**
 * Light/dark switch. The initial mode is applied before first paint by the
 * boot script in index.html; this only reflects and changes it.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<"light" | "dark">(() => resolveTheme(readTheme()));

  // While following the OS ("system"), keep the icon in step with it.
  useEffect(() => {
    if (readTheme() !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readTheme() === "system") setMode(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const next = mode === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={mode === "dark" ? Sun : Moon}
      aria-label={`Switch to ${next} mode`}
      onClick={() => {
        applyTheme(next);
        setMode(next);
      }}
    />
  );
}
