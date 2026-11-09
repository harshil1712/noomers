import { describe, expect, test } from "vitest";
import { isAllowedEventHost, shouldDropForeignHost } from "../hostname";

const REQ = "https://app.noomers.com/collect";

describe("isAllowedEventHost", () => {
  test("matches the registered domain and subdomains", () => {
    expect(isAllowedEventHost("example.com", "example.com", REQ)).toBe(true);
    expect(isAllowedEventHost("blog.example.com", "example.com", REQ)).toBe(true);
    expect(isAllowedEventHost("www.example.com", "example.com", REQ)).toBe(true);
  });
  test("normalises case and trailing dot", () => {
    expect(isAllowedEventHost("Example.COM.", "example.com", REQ)).toBe(true);
  });
  test("rejects suffix-squatting and unrelated hosts", () => {
    expect(isAllowedEventHost("notexample.com", "example.com", REQ)).toBe(false);
    expect(isAllowedEventHost("example.com.evil.net", "example.com", REQ)).toBe(false);
    expect(isAllowedEventHost("other.net", "example.com", REQ)).toBe(false);
  });
  test("accepts a full origin or URL as host", () => {
    expect(isAllowedEventHost("https://example.com/path", "example.com", REQ)).toBe(true);
  });
  test("local instance also allows localhost page hosts", () => {
    const local = "http://localhost:1338/collect";
    expect(isAllowedEventHost("localhost", "example.com", local)).toBe(true);
    expect(isAllowedEventHost("127.0.0.1", "example.com", local)).toBe(true);
    expect(isAllowedEventHost("localhost", "example.com", REQ)).toBe(false);
  });
});

describe("shouldDropForeignHost", () => {
  const req = (origin: string | null) =>
    new Request("https://app.noomers.com/collect", {
      headers: origin ? { origin } : {},
    });
  test("matching origin + host records", () => {
    expect(
      shouldDropForeignHost(req("https://blog.example.com"), "example.com", "example.com"),
    ).toBe(false);
  });
  test("mismatched origin drops", () => {
    expect(shouldDropForeignHost(req("https://evil.net"), "example.com", "example.com")).toBe(true);
  });
  test("absent origin relies on page host only", () => {
    expect(shouldDropForeignHost(req(null), "example.com", "example.com")).toBe(false);
    expect(shouldDropForeignHost(req(null), "evil.net", "example.com")).toBe(true);
  });
});
