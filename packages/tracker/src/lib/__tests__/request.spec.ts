import { beforeEach, describe, expect, test, vi } from "vitest";

import { makeRequest } from "../request";

describe("browser makeRequest", () => {
    const xhr = {
        open: vi.fn(),
        setRequestHeader: vi.fn(),
        send: vi.fn(),
        timeout: 0,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal(
            "XMLHttpRequest",
            vi.fn(function () {
                return xhr;
            }),
        );
    });

    test("sends custom event properties in a POST body", () => {
        makeRequest("https://example.com/collect", {
            sid: "example",
            h: "example.com",
            p: "/signup",
            r: "",
            en: "Signup",
            ep: '{"plan":"pro"}',
        });

        expect(xhr.open).toHaveBeenCalledWith(
            "POST",
            "https://example.com/collect",
            true,
        );
        expect(xhr.setRequestHeader).toHaveBeenCalledWith(
            "Content-Type",
            "application/x-www-form-urlencoded",
        );
        expect(xhr.send).toHaveBeenCalledWith(
            expect.stringContaining("ep=%7B%22plan%22%3A%22pro%22%7D"),
        );
    });
});
