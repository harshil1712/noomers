import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeRequest } from "../request";
import type { CollectRequestParams } from "../../shared/types";

// Mock fetch and request serialization
global.fetch = vi.fn();

class MockAbortController {
    signal = {} as AbortSignal;
    abort = vi.fn();
}

global.AbortController = MockAbortController;
global.setTimeout = vi.fn().mockImplementation(() => {
    return 123 as any; // Mock timeout ID
}) as any;
global.clearTimeout = vi.fn();

vi.mock("../../shared/utils", () => ({
    queryParamStringify: vi.fn(),
}));

describe("makeRequest", () => {
    const mockFetch = fetch as ReturnType<typeof vi.fn>;
    const mockAbort = vi.fn();
    const mockAbortController = {
        signal: {},
        abort: mockAbort,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should make a POST request with parameters in the body", async () => {
        const { queryParamStringify } = await import("../../shared/utils");
        const mockQueryParamStringify = queryParamStringify as ReturnType<
            typeof vi.fn
        >;

        mockQueryParamStringify.mockReturnValue(
            "?p=%2Ftest&h=example.com&ip=203.0.113.10",
        );

        mockFetch.mockResolvedValue({
            text: vi.fn().mockResolvedValue("ok"),
        } as any);

        const url = "https://example.com/collect";
        const params: CollectRequestParams = {
            p: "/test",
            h: "example.com",
            r: "",
            sid: "test-site",
            ip: "203.0.113.10",
        };

        await makeRequest(url, params);

        expect(mockQueryParamStringify).toHaveBeenCalledWith(params, true);
        expect(mockFetch).toHaveBeenCalledWith(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "noomers-tracker-server/3.4.1",
            },
            body: "p=%2Ftest&h=example.com&ip=203.0.113.10",
            signal: mockAbortController.signal,
        });
    });

    it("should forward the visitor user agent", async () => {
        const { queryParamStringify } = await import("../../shared/utils");
        vi.mocked(queryParamStringify).mockReturnValue(
            "?sid=test-site&ip=203.0.113.10",
        );
        mockFetch.mockResolvedValue({
            text: vi.fn().mockResolvedValue("ok"),
        } as any);

        await makeRequest(
            "https://example.com/collect",
            {
                sid: "test-site",
                p: "/",
                h: "example.com",
                r: "",
                ip: "203.0.113.10",
            },
            1000,
            "Visitor Browser",
        );

        expect(mockFetch).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                headers: expect.objectContaining({
                    "User-Agent": "Visitor Browser",
                }),
            }),
        );
    });

    it("should set up timeout and clear it on success", async () => {
        const { queryParamStringify } = await import("../../shared/utils");
        vi.mocked(queryParamStringify).mockReturnValue("");
        mockFetch.mockResolvedValue({
            text: vi.fn().mockResolvedValue("ok"),
        } as any);

        const timeout = 2000;
        await makeRequest("https://example.com/collect", {} as any, timeout);

        expect(global.setTimeout).toHaveBeenCalledWith(
            expect.any(Function),
            timeout,
        );
        expect(global.clearTimeout).toHaveBeenCalledWith(123);
    });

    it("should use default timeout when not specified", async () => {
        const { queryParamStringify } = await import("../../shared/utils");
        vi.mocked(queryParamStringify).mockReturnValue("");
        mockFetch.mockResolvedValue({
            text: vi.fn().mockResolvedValue("ok"),
        } as any);

        await makeRequest("https://example.com/collect", {} as any);

        expect(global.setTimeout).toHaveBeenCalledWith(
            expect.any(Function),
            1000,
        );
    });

    it("should consume response text", async () => {
        const { queryParamStringify } = await import("../../shared/utils");
        vi.mocked(queryParamStringify).mockReturnValue("");
        const mockText = vi.fn().mockResolvedValue("response body");
        mockFetch.mockResolvedValue({
            text: mockText,
        } as any);

        await makeRequest("https://example.com/collect", {} as any);

        expect(mockText).toHaveBeenCalled();
    });

    it("should not throw on fetch error", async () => {
        const { queryParamStringify } = await import("../../shared/utils");
        vi.mocked(queryParamStringify).mockReturnValue("");
        mockFetch.mockRejectedValue(new Error("Network error"));

        await expect(
            makeRequest("https://example.com/collect", {} as any),
        ).resolves.not.toThrow();
    });

    it("should not throw on timeout", async () => {
        const { queryParamStringify } = await import("../../shared/utils");
        vi.mocked(queryParamStringify).mockReturnValue("");
        mockFetch.mockImplementation(
            () => new Promise((_, reject) => reject(new Error("Timeout"))),
        );

        await expect(
            makeRequest("https://example.com/collect", {} as any),
        ).resolves.not.toThrow();
    });

    it("should set up abort controller", async () => {
        const { queryParamStringify } = await import("../../shared/utils");
        vi.mocked(queryParamStringify).mockReturnValue("");
        mockFetch.mockResolvedValue({
            text: vi.fn().mockResolvedValue("ok"),
        } as any);

        // Spy on AbortController constructor
        const abortControllerSpy = vi.spyOn(global, "AbortController");

        await makeRequest("https://example.com/collect", {} as any);

        expect(abortControllerSpy).toHaveBeenCalled();
        abortControllerSpy.mockRestore();
    });
});
