import { useSyncExternalStore } from "react";
import { dashboardApi, DashboardApiError } from "./dashboard-api";

export interface SiteInfo {
  domain: string;
  timezone: string;
}

interface SitesState {
  sites: SiteInfo[] | null;
  error: boolean;
  forbidden: boolean;
}

let state: SitesState = { sites: null, error: false, forbidden: false };
const listeners = new Set<() => void>();
let loading = false;

function set(next: SitesState) {
  state = next;
  for (const l of listeners) l();
}

export async function refreshSites(): Promise<void> {
  loading = true;
  try {
    const r = await dashboardApi.sites();
    set({ sites: r.details, error: false, forbidden: false });
  } catch (e) {
    if (e instanceof DashboardApiError && e.status === 403) {
      set({ sites: null, error: false, forbidden: true });
    } else {
      set({ ...state, error: true });
    }
  } finally {
    loading = false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (state.sites === null && !loading) void refreshSites();
  return () => listeners.delete(listener);
}

export function useSites(): SitesState {
  return useSyncExternalStore(subscribe, () => state);
}

export function sitesSnapshot(): SitesState {
  return state;
}
