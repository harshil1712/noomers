import { describe, it, expect, vi } from "vitest";
import { buildCollectRequestParams, buildCollectUrl } from "../request";
import type { UtmParams, CollectRequestParams } from "../types";

vi.mock("../utils", () => ({
    queryParamStringify: vi.fn(),
}));

describe("Shared Request Utils", () => {
    describe("buildCollectRequestParams", () => {
        it("should build basic request parameters", () => {
            const result = buildCollectRequestParams(
                "test-site",
                "https://example.com",
                "/path",
                "https://referrer.com",
            );

            expect(result).toEqual({
                p: "/path",
                h: "https://example.com",
                r: "https://referrer.com",
                sid: "test-site",
            });
        });

        it("should include hit type when provided", () => {
            const result = buildCollectRequestParams(
                "test-site",
                "https://example.com",
                "/path",
                "https://referrer.com",
                {},
                "1",
            );

            expect(result).toEqual({
                p: "/path",
                h: "https://example.com",
                r: "https://referrer.com",
                sid: "test-site",
                ht: "1",
            });
        });

        it("should include a custom event and its properties", () => {
            const result = buildCollectRequestParams(
                "test-site",
                "example.com",
                "/signup",
                "",
                {},
                undefined,
                {
                    name: "Signup",
                    props: { plan: "pro", seats: 3, trial: true },
                },
            );

            expect(result).toEqual({
                p: "/signup",
                h: "example.com",
                r: "",
                sid: "test-site",
                en: "Signup",
                ep: JSON.stringify({ plan: "pro", seats: 3, trial: true }),
            });
        });

        it("should reject invalid or oversized event properties", () => {
            expect(() =>
                buildCollectRequestParams(
                    "test-site",
                    "example.com",
                    "/signup",
                    "",
                    {},
                    undefined,
                    {
                        name: "Signup",
                        props: { nested: {} } as never,
                    },
                ),
            ).toThrow("Event properties must be strings");

            expect(() =>
                buildCollectRequestParams(
                    "test-site",
                    "example.com",
                    "/signup",
                    "",
                    {},
                    undefined,
                    {
                        name: "Signup",
                        props: { value: "x".repeat(2049) },
                    },
                ),
            ).toThrow("must not exceed 2048 characters");
        });

        it("should merge UTM parameters", () => {
            const utmParams: UtmParams = {
                us: "google",
                um: "cpc",
                uc: "summer",
            };

            const result = buildCollectRequestParams(
                "test-site",
                "https://example.com",
                "/path",
                "",
                utmParams,
            );

            expect(result).toEqual({
                p: "/path",
                h: "https://example.com",
                r: "",
                sid: "test-site",
                us: "google",
                um: "cpc",
                uc: "summer",
            });
        });

        it("should handle empty UTM parameters", () => {
            const result = buildCollectRequestParams(
                "test-site",
                "https://example.com",
                "/path",
                "",
                {},
            );

            expect(result).toEqual({
                p: "/path",
                h: "https://example.com",
                r: "",
                sid: "test-site",
            });
        });

        it("should handle undefined UTM parameters", () => {
            const result = buildCollectRequestParams(
                "test-site",
                "https://example.com",
                "/path",
                "",
            );

            expect(result).toEqual({
                p: "/path",
                h: "https://example.com",
                r: "",
                sid: "test-site",
            });
        });

        it("should include all parameters when all are provided", () => {
            const utmParams: UtmParams = {
                us: "facebook",
                um: "social",
                uc: "winter",
                ut: "boots",
                uco: "ad2",
            };

            const result = buildCollectRequestParams(
                "full-site",
                "https://full-example.com",
                "/full-path",
                "https://full-referrer.com",
                utmParams,
                "2",
            );

            expect(result).toEqual({
                p: "/full-path",
                h: "https://full-example.com",
                r: "https://full-referrer.com",
                sid: "full-site",
                ht: "2",
                us: "facebook",
                um: "social",
                uc: "winter",
                ut: "boots",
                uco: "ad2",
            });
        });
    });

    describe("buildCollectUrl", () => {
        it("should build URL with query parameters", async () => {
            const { queryParamStringify } = await import("../utils");
            const mockQueryParamStringify = queryParamStringify as ReturnType<
                typeof vi.fn
            >;

            mockQueryParamStringify.mockReturnValue("?p=test&h=example");

            const params: CollectRequestParams = {
                p: "/test",
                h: "https://example.com",
                r: "",
                sid: "test-site",
            };

            const result = buildCollectUrl(
                "https://collect.example.com",
                params,
            );

            expect(mockQueryParamStringify).toHaveBeenCalledWith(params, false);
            expect(result).toBe("https://collect.example.com?p=test&h=example");
        });

        it("should pass filterEmpty parameter to queryParamStringify", async () => {
            const { queryParamStringify } = await import("../utils");
            const mockQueryParamStringify = queryParamStringify as ReturnType<
                typeof vi.fn
            >;

            mockQueryParamStringify.mockReturnValue("?p=test&h=example");

            const params: CollectRequestParams = {
                p: "/test",
                h: "https://example.com",
                r: "",
                sid: "test-site",
            };

            buildCollectUrl("https://collect.example.com", params, true);

            expect(mockQueryParamStringify).toHaveBeenCalledWith(params, true);
        });

        it("should handle empty base URL", async () => {
            const { queryParamStringify } = await import("../utils");
            const mockQueryParamStringify = queryParamStringify as ReturnType<
                typeof vi.fn
            >;

            mockQueryParamStringify.mockReturnValue("?p=test");

            const params: CollectRequestParams = {
                p: "/test",
                h: "https://example.com",
                r: "",
                sid: "test-site",
            };

            const result = buildCollectUrl("", params);

            expect(result).toBe("?p=test");
        });

        it("should handle complex parameters", async () => {
            const { queryParamStringify } = await import("../utils");
            const mockQueryParamStringify = queryParamStringify as ReturnType<
                typeof vi.fn
            >;

            const complexQuery =
                "?p=%2Fpath&h=https%3A//example.com&us=google&um=cpc";
            mockQueryParamStringify.mockReturnValue(complexQuery);

            const params: CollectRequestParams = {
                p: "/path",
                h: "https://example.com",
                r: "",
                sid: "test-site",
                us: "google",
                um: "cpc",
            };

            const result = buildCollectUrl(
                "https://api.example.com/collect",
                params,
            );

            expect(result).toBe(
                `https://api.example.com/collect${complexQuery}`,
            );
        });
    });
});
