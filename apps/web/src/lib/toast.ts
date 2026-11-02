import { createKumoToastManager } from "@cloudflare/kumo";

/** Single toast manager for the app — mounted by `<Toasty>` in main.tsx. */
export const appToastManager = createKumoToastManager();

type Variant = "success" | "error" | "info" | "warning";

function show(variant: Variant, title: string, description?: string) {
  appToastManager.add({ variant, title, description });
}

/**
 * App toasts. Always pick a variant so failures never look like successes.
 *
 * @example
 * toast.success("Name saved");
 * toast.error("Couldn't save name", authErrorMessage(r.error));
 */
export const toast = {
  success: (title: string, description?: string) => show("success", title, description),
  error: (title: string, description?: string) => show("error", title, description),
  info: (title: string, description?: string) => show("info", title, description),
  warning: (title: string, description?: string) => show("warning", title, description),
};
