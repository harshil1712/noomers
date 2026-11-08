import { useEffect, useState } from "react";

export interface PublicConfig {
  googleEnabled: boolean;
  turnstileSiteKey: string;
  signupEnabled: boolean;
}

/** "Feature off" safe path until the response arrives. */
const DEFAULTS: PublicConfig = { googleEnabled: false, turnstileSiteKey: "", signupEnabled: false };

let resolved: PublicConfig | null = null;
let pending: Promise<PublicConfig> | null = null;

function load(): Promise<PublicConfig> {
  pending ??= fetch("/api/public-config")
    .then((r) =>
      r.ok
        ? (r.json() as Promise<{
            googleEnabled?: boolean;
            turnstileSiteKey?: string;
            signupEnabled?: boolean;
          }>)
        : null,
    )
    .then((data) => {
      resolved = {
        googleEnabled: Boolean(data?.googleEnabled),
        turnstileSiteKey: data?.turnstileSiteKey ?? "",
        signupEnabled: data?.signupEnabled === undefined ? true : Boolean(data?.signupEnabled),
      };
      return resolved;
    })
    .catch(() => {
      // Offline or blocked: let the next mount retry.
      pending = null;
      return DEFAULTS;
    });
  return pending;
}

/** Awaitable copy for route guards (beforeLoad) that can't use the hook. */
export const loadPublicConfig = load;

/**
 * Unauthenticated feature flags from GET /api/public-config. Fetched once per
 * page load and shared by every caller.
 */
export function usePublicConfig(): PublicConfig {
  const [config, setConfig] = useState<PublicConfig>(resolved ?? DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    void load().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}
