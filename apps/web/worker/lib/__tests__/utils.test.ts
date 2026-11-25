import { describe, test, expect } from "vite-plus/test";
import { maskBrowserVersion } from "../utils";

describe("maskBrowserVersion", () => {
  const browserVersions: Array<[string, string | undefined, string | undefined]> = [
    ["Google Chrome", "148.0.7271.12", "148.0"],
    ["Mozilla Firefox", "160.0", "160.0"],
    ["Safari", "18.3.1", "18.3"],
    ["major only", "27", "27.0"],
    ["trailing dot", "148.", "148.0"],
    ["empty string", "", ""],
    ["undefined", undefined, undefined],
  ];

  test.each(browserVersions)("%s", (_, version, expected) => {
    expect(maskBrowserVersion(version)).toEqual(expected);
  });

  test("bounds each segment to 16 characters", () => {
    const version = "9".repeat(10_000) + "." + "1".repeat(10_000) + ".2.3";
    const masked = maskBrowserVersion(version);
    expect(masked).toEqual("9".repeat(16) + "." + "1".repeat(16));
    expect(masked!.length).toBeLessThanOrEqual(33);
  });
});
