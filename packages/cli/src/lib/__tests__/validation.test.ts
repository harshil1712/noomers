import { describe, it, expect } from "vitest";
import {
    normalizeDomain,
    normalizeTimezone,
    isValidDomain,
    isValidTimezone,
} from "../validation.js";

describe("normalizeDomain", () => {
    it("trims and lowercases the domain", () => {
        expect(normalizeDomain("  EXAMPLE.COM  ")).toBe("example.com");
    });

    it("accepts a valid subdomain", () => {
        expect(normalizeDomain("Sub.Example.com")).toBe("sub.example.com");
    });

    it("rejects empty domains", () => {
        expect(() => normalizeDomain("")).toThrow("A valid domain is required");
        expect(() => normalizeDomain("   ")).toThrow();
    });

    it("rejects domains with spaces, slashes, or colons", () => {
        expect(() => normalizeDomain("bad domain")).toThrow();
        expect(() => normalizeDomain("a/b.com")).toThrow();
        expect(() => normalizeDomain("a:b.com")).toThrow();
    });

    it("rejects domains over 253 characters", () => {
        expect(() => normalizeDomain("a".repeat(254))).toThrow();
    });

    it("accepts a domain of exactly 253 characters", () => {
        expect(normalizeDomain("a".repeat(253))).toBe("a".repeat(253));
    });
});

describe("normalizeTimezone", () => {
    it("defaults to UTC when omitted", () => {
        expect(normalizeTimezone()).toBe("Etc/UTC");
        expect(normalizeTimezone("")).toBe("Etc/UTC");
    });

    it("accepts a valid IANA timezone", () => {
        expect(normalizeTimezone("America/New_York")).toBe("America/New_York");
    });

    it("rejects an invalid IANA timezone", () => {
        expect(() => normalizeTimezone("Not/AZone")).toThrow(
            "A valid IANA timezone is required",
        );
    });
});

describe("isValidDomain / isValidTimezone", () => {
    it("returns booleans without throwing", () => {
        expect(isValidDomain("example.com")).toBe(true);
        expect(isValidDomain("bad domain")).toBe(false);
        expect(isValidTimezone("Etc/UTC")).toBe(true);
        expect(isValidTimezone("bogus")).toBe(false);
    });
});
