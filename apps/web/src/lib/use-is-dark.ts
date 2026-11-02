import { useEffect, useState } from "react";

export function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.dataset.mode === "dark",
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.dataset.mode === "dark"));
    obs.observe(el, { attributes: true, attributeFilter: ["data-mode"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
