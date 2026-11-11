import { describe, it, expect } from "vite-plus/test";
import { resolveTrackerConfig } from "../tracker-config";

function scriptEl(src: string, attrs: Record<string, string> = {}) {
  const el = document.createElement("script");
  el.setAttribute("src", src);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el as HTMLScriptElement;
}

describe("resolveTrackerConfig", () => {
  it("resolves site id and /collect from a no-id user snippet", () => {
    const el = scriptEl("https://app.noomers.com/tracker.js", { "data-site-id": "example.com" });
    expect(resolveTrackerConfig(el)).toEqual({
      siteId: "example.com",
      reportOnLocalhost: false,
      reporterUrl: "https://app.noomers.com/collect",
      outboundLinks: true,
    });
  });

  it("disables outbound link tracking with data-outbound=false", () => {
    const el = scriptEl("https://app.noomers.com/tracker.js", {
      "data-site-id": "example.com",
      "data-outbound": "false",
    });
    expect(resolveTrackerConfig(el)?.outboundLinks).toBe(false);
  });

  it("resolves /collect on the script origin for custom script names", () => {
    const el = scriptEl("https://app.noomers.com/js/pa-abc123.js", { "data-site-id": "example.com" });
    expect(resolveTrackerConfig(el)?.reporterUrl).toBe("https://app.noomers.com/collect");
  });

  it("honours data-report-localhost", () => {
    const el = scriptEl("http://localhost:1338/tracker.js", {
      "data-site-id": "example.com",
      "data-report-localhost": "",
    });
    expect(resolveTrackerConfig(el)?.reportOnLocalhost).toBe(true);
  });

  it("returns null without a site id", () => {
    expect(resolveTrackerConfig(scriptEl("https://x/tracker.js"))).toBeNull();
    expect(resolveTrackerConfig(null)).toBeNull();
  });
});
