import {
  getFiltersFromSearchParams,
  getDateTimeRange,
  getIntervalType,
  maskBrowserVersion,
} from "../worker/lib/utils";
import { describe, test, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

// test this getfiltersfromsearchparams function
describe("getFiltersFromSearchParams", () => {
  test("it should return an object with the correct keys", () => {
    const searchParams = new URLSearchParams(
      "?path=/about&referrer=google.com&deviceType=mobile&country=us&browserName=chrome&browserVersion=118",
    );
    expect(getFiltersFromSearchParams(searchParams)).toEqual({
      path: "/about",
      referrer: "google.com",
      deviceType: "mobile",
      country: "us",
      browserName: "chrome",
      browserVersion: "118",
    });
  });

  test("it should ignore keys it doesn't recognize", () => {
    // only path is valid; unknown should be discarded
    const searchParams = new URLSearchParams("?unknown=foo&path=/about");
    expect(getFiltersFromSearchParams(searchParams)).toEqual({
      path: "/about",
    });
  });

  test("it should handle UTM parameters correctly", () => {
    const searchParams = new URLSearchParams(
      "?utmSource=google&utmMedium=cpc&utmCampaign=summer_sale&utmTerm=analytics&utmContent=banner_ad&path=/landing",
    );
    expect(getFiltersFromSearchParams(searchParams)).toEqual({
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "summer_sale",
      utmTerm: "analytics",
      utmContent: "banner_ad",
      path: "/landing",
    });
  });

  test("it should handle mixed standard and UTM parameters", () => {
    const searchParams = new URLSearchParams(
      "?path=/about&referrer=google.com&utmSource=google&utmMedium=email&browserName=chrome",
    );
    expect(getFiltersFromSearchParams(searchParams)).toEqual({
      path: "/about",
      referrer: "google.com",
      utmSource: "google",
      utmMedium: "email",
      browserName: "chrome",
    });
  });
});

describe("getDateTimeRange", () => {
  const tz = "America/Los_Angeles";
  const mockDate = new Date("2024-01-15T15:00:00Z"); // 7am PST on Jan 15, 2024

  beforeEach(() => {
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("handles 'today' interval", () => {
    const { startDate, endDate } = getDateTimeRange("today", tz);

    // Start date should be Jan 15, 2024 00:00 PST
    expect(startDate).toEqual(new Date("2024-01-15T08:00:00Z")); // 00:00 PST = 08:00 UTC
    expect(endDate).toEqual(new Date("2024-01-15T15:00:00Z")); // Current time (7am PST = 15:00 UTC)
  });

  test("handles 'yesterday' interval", () => {
    const { startDate, endDate } = getDateTimeRange("yesterday", tz);

    expect(startDate).toEqual(new Date("2024-01-14T08:00:00Z"));
    expect(endDate).toEqual(new Date("2024-01-15T08:00:00.001Z"));
  });

  test("handles '7d' interval", () => {
    const { startDate, endDate } = getDateTimeRange("7d", tz);

    expect(startDate).toEqual(new Date("2024-01-08T08:00:00Z"));
    expect(endDate).toEqual(new Date("2024-01-15T15:00:00Z"));
  });

  test("handles '1d' interval", () => {
    const { startDate, endDate } = getDateTimeRange("1d", tz);

    expect(startDate).toEqual(new Date("2024-01-14T15:00:00Z"));
    expect(endDate).toEqual(new Date("2024-01-15T15:00:00Z"));
  });

  test("works with different timezones", () => {
    const tokyoTz = "Asia/Tokyo"; // UTC+9
    const londonTz = "Europe/London"; // UTC+0 in January

    // When it's 7am PST (15:00 UTC) on Jan 15:
    // - Tokyo: 00:00 JST on Jan 16
    // - London: 15:00 GMT on Jan 15
    // - LA: 7:00 PST on Jan 15

    const tokyo = getDateTimeRange("today", tokyoTz);
    const london = getDateTimeRange("today", londonTz);

    // Tokyo's start date should be Jan 15 15:00 UTC (00:00 JST Jan 16)
    expect(tokyo.startDate).toEqual(new Date("2024-01-15T15:00:00Z"));
    // London's start date should be Jan 15 00:00 UTC
    expect(london.startDate).toEqual(new Date("2024-01-15T00:00:00Z"));
  });
});

describe("maskBrowserVersion", () => {
  const browserVersions = [
    ["Microsoft Edge", "119.0.0.0", "119.x.x.x"],
    ["Google Chrome", "119.0.0.0", "119.x.x.x"],
    ["Mozilla Firefox", "119.0", "119.x"],
    ["Safari", "605.1.15", "605.x.x"],
    ["DuckDuckGo", "5", "5"],
    ["Brave", "129.0.6668.54", "129.x.x.x"],
    ["Opera", "117.0.0.0", "117.x.x.x"],
  ];

  test.each(browserVersions)("%s", (_, version, expected) => {
    expect(maskBrowserVersion(version)).toEqual(expected);
  });
});

describe("getDateTimeRange intervals", () => {
  test("month / Nmo / unknown intervals", () => {
    const month = getDateTimeRange("month", "UTC");
    const d = new Date(month.startDate);
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCHours()).toBe(0);
    const six = getDateTimeRange("6mo", "UTC");
    const now = new Date();
    const expected = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    expect(six.startDate.getTime()).toBe(expected.getTime());
    expect(() => getDateTimeRange("bogus", "UTC")).toThrow("Unsupported interval");
    expect(() => getDateTimeRange("week", "UTC")).toThrow();
  });

  test("Nd starts at beginning of day in tz", () => {
    const { startDate } = getDateTimeRange("30d", "UTC");
    const d = new Date(startDate);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
  });
});

describe("getIntervalType", () => {
  test("maps intervals to bucket types", () => {
    expect(getIntervalType("1d")).toBe("HOUR");
    expect(getIntervalType("day")).toBe("HOUR");
    expect(getIntervalType("today")).toBe("HOUR");
    expect(getIntervalType("yesterday")).toBe("HOUR");
    expect(getIntervalType("7d")).toBe("DAY");
    expect(getIntervalType("30d")).toBe("DAY");
    expect(getIntervalType("month")).toBe("DAY");
    expect(getIntervalType("6mo")).toBe("MONTH");
    expect(getIntervalType("12mo")).toBe("MONTH");
    expect(() => getIntervalType("bogus")).toThrow();
  });
});

describe("getDateTimeRange across DST and timezones", () => {
  afterEach(() => vi.useRealTimers());
  test.each([
    ["7d", "Europe/Berlin", "2026-11-01T23:00:00.000Z"],
    ["30d", "America/New_York", "2026-10-10T04:00:00.000Z"],
    ["day", "Europe/Berlin", "2026-11-08T23:00:00.000Z"],
    ["month", "America/New_York", "2026-11-01T04:00:00.000Z"],
    ["6mo", "Europe/Berlin", "2026-05-31T22:00:00.000Z"],
    ["12mo", "Asia/Kolkata", "2025-11-30T18:30:00.000Z"],
    ["1d", "Asia/Kolkata", "2026-11-08T09:30:00.000Z"],
  ])("%s in %s", (interval, tz, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T09:40:00.000Z"));
    expect(getDateTimeRange(interval, tz).startDate.toISOString()).toBe(expected);
  });
});
