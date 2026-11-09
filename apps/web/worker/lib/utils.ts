import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

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

export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Fallback to UTC if browser doesn't support Intl API
    return "UTC";
  }
}

export type IntervalType = "HOUR" | "DAY" | "MONTH";

export function getIntervalType(interval: string): IntervalType {
  if (interval === "1d" || interval === "day" || interval === "today" || interval === "yesterday") {
    return "HOUR";
  }
  if (/^\d+d$/.test(interval) || interval === "month") {
    return "DAY";
  }
  if (/^\d+mo$/.test(interval)) {
    return "MONTH";
  }
  throw new Error("Unsupported interval");
}

export function getDateTimeRange(interval: string, tz: string) {
  const now = dayjs().utc().tz(tz);
  let localDateTime = now;
  let localEndDateTime: dayjs.Dayjs | undefined;

  if (interval === "1d") {
    localDateTime = now.subtract(24, "hour").startOf("hour");
  } else if (interval === "day" || interval === "today") {
    localDateTime = now.startOf("day");
  } else if (interval === "yesterday") {
    localDateTime = now.startOf("day").subtract(1, "day");
    localEndDateTime = localDateTime.endOf("day").add(2, "ms");
  } else if (/^\d+d$/.test(interval)) {
    localDateTime = now.subtract(Number(interval.slice(0, -1)), "day").startOf("day");
  } else if (interval === "month") {
    localDateTime = now.startOf("month");
  } else if (/^\d+mo$/.test(interval)) {
    localDateTime = now.startOf("month").subtract(Number(interval.slice(0, -2)) - 1, "month");
  } else {
    throw new Error("Unsupported interval");
  }

  if (!localEndDateTime) {
    localEndDateTime = dayjs().utc().tz(tz);
  }

  return {
    startDate: localDateTime.toDate(),
    endDate: localEndDateTime.toDate(),
  };
}

export function maskBrowserVersion(version?: string) {
  if (!version) return version;

  const majorEnd = version.indexOf(".");

  if (majorEnd != -1) {
    version = version.substring(0, majorEnd) + version.slice(majorEnd).replaceAll(/\.[^.]+/g, ".x");
  }

  return version;
}
