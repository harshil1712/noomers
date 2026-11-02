import { describe, expect, test } from "vite-plus/test";
import { shouldDropBot } from "../bot";

const browserUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function requestWithUserAgent(userAgent?: string): Request {
  const headers: Record<string, string> =
    userAgent !== undefined ? { "user-agent": userAgent } : {};
  return new Request("https://example.com/collect?sid=test", { headers });
}

describe("shouldDropBot", () => {
  test("allows a real browser user agent", () => {
    expect(shouldDropBot(requestWithUserAgent(browserUserAgent))).toBe(false);
  });

  test("drops a known crawler user agent", () => {
    expect(
      shouldDropBot(requestWithUserAgent("Googlebot/2.1 (+http://www.google.com/bot.html)")),
    ).toBe(true);
  });

  test("drops an agent-browser user agent", () => {
    expect(shouldDropBot(requestWithUserAgent("agent-browser"))).toBe(true);
  });

  test("drops requests with no user-agent", () => {
    expect(shouldDropBot(requestWithUserAgent(undefined))).toBe(true);
  });

  test.each([["noomers-tracker-server/3.4.1"], ["noomers-tracker-server/1.0.0"]])(
    "exempts the first-party server tracker UA prefix (%s)",
    (userAgent) => {
      expect(shouldDropBot(requestWithUserAgent(userAgent))).toBe(false);
    },
  );

  test("classifies a custom generic server user agent as a bot", () => {
    expect(shouldDropBot(requestWithUserAgent("MyServer/1.0"))).toBe(true);
  });

  test("is case-sensitive about the server tracker prefix", () => {
    expect(shouldDropBot(requestWithUserAgent("Noomers-Tracker-Server/1.0"))).toBe(true);
  });
});
