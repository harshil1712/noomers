import { beforeEach, describe, expect, test, vi } from "vitest";

import { makeRequest, sendLifecycleRequest } from "../request";

describe("browser makeRequest", () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response()));

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("fetch", fetchMock);
    });

    const params = {
        sid: "example",
        h: "example.com",
        p: "/signup",
        r: "",
    };

    test("sends a pageview GET with keepalive and no credentials", () => {
        makeRequest("https://example.com/collect", { ...params });

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain("https://example.com/collect?");
        expect(String(url)).toContain("sid=example");
        expect(init).toMatchObject({
            method: "GET",
            keepalive: true,
            credentials: "omit",
        });
        expect((init as RequestInit).signal ?? null).toBeNull();
    });

    test("sends custom event properties in a POST body", () => {
        makeRequest("https://example.com/collect", {
            ...params,
            en: "Signup",
            ep: '{"plan":"pro"}',
        });

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe("https://example.com/collect");
        expect(init).toMatchObject({
            method: "POST",
            keepalive: true,
            credentials: "omit",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        expect(String(init?.body)).toContain("ep=%7B%22plan%22%3A%22pro%22%7D");
    });

    test("sends engagement events as POST with et parameter", () => {
        makeRequest("https://example.com/collect", {
            ...params,
            et: "engagement",
            e: "5000",
        });

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe("https://example.com/collect");
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("et=engagement&e=5000");
    });

    test("a rejected fetch does not throw", () => {
        fetchMock.mockRejectedValueOnce(new Error("offline"));
        expect(() =>
            makeRequest("https://example.com/collect", { ...params }),
        ).not.toThrow();
    });
});

describe("sendLifecycleRequest", () => {
    const sendBeaconMock = vi.fn<
        (url: string, data?: BodyInit | null) => boolean
    >(() => true);
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response()));

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal(
            "navigator",
            { sendBeacon: sendBeaconMock } as unknown as Navigator,
        );
        vi.stubGlobal("fetch", fetchMock);
        sendBeaconMock.mockReturnValue(true);
    });

    test("prefers navigator.sendBeacon with a url-encoded blob", () => {
        sendLifecycleRequest("https://example.com/collect", {
            sid: "example",
            h: "example.com",
            p: "/article",
            r: "",
            et: "engagement",
            e: "5000",
        });

        expect(sendBeaconMock).toHaveBeenCalledTimes(1);
        const [url, blob] = sendBeaconMock.mock.calls[0];
        expect(url).toBe("https://example.com/collect");
        expect(blob).toBeInstanceOf(Blob);
        expect((blob as Blob).type).toBe("application/x-www-form-urlencoded");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("falls back to fetch keepalive when sendBeacon returns false", () => {
        sendBeaconMock.mockReturnValue(false);

        sendLifecycleRequest("https://example.com/collect", {
            sid: "example",
            h: "example.com",
            p: "/article",
            r: "",
            et: "engagement",
            e: "5000",
        });

        expect(sendBeaconMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                method: "POST",
                keepalive: true,
                body: expect.any(String),
            }),
        );
    });

    test("falls back to fetch keepalive when sendBeacon throws", () => {
        sendBeaconMock.mockImplementation(() => {
            throw new Error("sendBeacon disabled");
        });

        sendLifecycleRequest("https://example.com/collect", {
            sid: "example",
            h: "example.com",
            p: "/article",
            r: "",
            et: "engagement",
            e: "5000",
        });

        expect(sendBeaconMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({ keepalive: true }),
        );
    });

    test("falls back to fetch keepalive when sendBeacon is unavailable", () => {
        vi.stubGlobal("navigator", {} as unknown as Navigator);

        sendLifecycleRequest("https://example.com/collect", {
            sid: "example",
            h: "example.com",
            p: "/article",
            r: "",
            et: "engagement",
            e: "5000",
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({ keepalive: true }),
        );
    });
});
