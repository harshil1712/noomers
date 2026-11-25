export function paramsFromUrl(url: string) {
  const searchParams = new URL(url).searchParams;
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

interface SearchFilters {
  name?: string;
  path?: string;
  referrer?: string;
  deviceType?: string;
  country?: string;
  browserName?: string;
  browserVersion?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

export function getFiltersFromSearchParams(searchParams: URLSearchParams) {
  const filters: SearchFilters = {};

  if (searchParams.has("path")) {
    filters.path = searchParams.get("path") || "";
  }
  if (searchParams.has("name")) {
    filters.name = searchParams.get("name") || "";
  }
  if (searchParams.has("referrer")) {
    filters.referrer = searchParams.get("referrer") || "";
  }
  if (searchParams.has("deviceType")) {
    filters.deviceType = searchParams.get("deviceType") || "";
  }
  if (searchParams.has("country")) {
    filters.country = searchParams.get("country") || "";
  }
  if (searchParams.has("browserName")) {
    filters.browserName = searchParams.get("browserName") || "";
  }
  if (searchParams.has("browserVersion")) {
    filters.browserVersion = searchParams.get("browserVersion") || "";
  }
  if (searchParams.has("utmSource")) {
    filters.utmSource = searchParams.get("utmSource") || "";
  }
  if (searchParams.has("utmMedium")) {
    filters.utmMedium = searchParams.get("utmMedium") || "";
  }
  if (searchParams.has("utmCampaign")) {
    filters.utmCampaign = searchParams.get("utmCampaign") || "";
  }
  if (searchParams.has("utmTerm")) {
    filters.utmTerm = searchParams.get("utmTerm") || "";
  }
  if (searchParams.has("utmContent")) {
    filters.utmContent = searchParams.get("utmContent") || "";
  }

  return filters;
}

const MAX_BROWSER_VERSION_SEGMENT_LENGTH = 16;

export function maskBrowserVersion(version?: string) {
  if (!version) return version;
  const [major, minor] = version.split(".", 2);
  const bound = (segment: string) => segment.slice(0, MAX_BROWSER_VERSION_SEGMENT_LENGTH);
  return `${bound(major)}.${bound(minor || "0")}`;
}
