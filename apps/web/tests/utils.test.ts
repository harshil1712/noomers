import { getFiltersFromSearchParams, maskBrowserVersion } from "../worker/lib/utils";
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
