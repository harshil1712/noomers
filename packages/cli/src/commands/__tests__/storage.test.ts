import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareClient } from "../../lib/cloudflare.js";
import { getDeploymentConfigPath } from "../../lib/config.js";
import { disableStorage, enableStorage } from "../storage.js";

vi.mock("../../lib/cloudflare.js", () => ({
    CloudflareClient: vi.fn(),
}));
vi.mock("../../lib/config.js", () => ({
    getDeploymentConfigPath: vi.fn(),
}));

describe("storage commands", () => {
    const setCloudflareSecrets = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getDeploymentConfigPath).mockReturnValue(
            "/mock/deployment/wrangler.json",
        );
        vi.mocked(CloudflareClient).mockImplementation(function () {
            return { setCloudflareSecrets } as any;
        });
        setCloudflareSecrets.mockResolvedValue(true);
        vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("enables storage on the installed deployment", async () => {
        await enableStorage();

        expect(CloudflareClient).toHaveBeenCalledWith(
            "/mock/deployment/wrangler.json",
        );
        expect(setCloudflareSecrets).toHaveBeenCalledWith({
            CF_STORAGE_ENABLED: "true",
        });
    });

    it("disables storage on the installed deployment", async () => {
        await disableStorage();

        expect(setCloudflareSecrets).toHaveBeenCalledWith({
            CF_STORAGE_ENABLED: "false",
        });
    });
});
