import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { handleTrackerScript } from "../worker/routes/scripts";

describe("Dynamic script route", () => {
  const mockRequest = {
    url: "https://example.com/analytics.js",
  } as Request;

  const mockAssetsFetch = vi.fn();

  const createMockEnv = (customScriptName?: string) =>
    ({
      CF_TRACKER_SCRIPT_NAME: customScriptName,
      ASSETS: {
        fetch: mockAssetsFetch,
      },
    }) as unknown as Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetsFetch.mockClear();
  });

  it("should return 404 for non-JS files", async () => {
    const response = await handleTrackerScript(mockRequest, createMockEnv(), "test.txt");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  it("should return 404 for undefined script param", async () => {
    const response = await handleTrackerScript(mockRequest, createMockEnv(), undefined);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  it("should serve default tracker.js", async () => {
    const mockResponse = new Response("console.log('tracker')", {
      headers: { "Content-Type": "application/javascript" },
    });
    mockAssetsFetch.mockResolvedValue(mockResponse);

    const response = await handleTrackerScript(
      { url: "https://example.com/tracker.js" } as Request,
      createMockEnv(),
      "tracker.js",
    );

    expect(response).toBe(mockResponse);
    expect(mockAssetsFetch).toHaveBeenCalledWith("https://example.com/tracker.js");
  });

  it("should serve custom script name when configured", async () => {
    const mockResponse = new Response("console.log('tracker')");
    mockAssetsFetch.mockResolvedValue(mockResponse);

    const response = await handleTrackerScript(
      { url: "https://example.com/analytics.js" } as Request,
      createMockEnv("analytics"),
      "analytics.js",
    );

    expect(response).toBe(mockResponse);
  });

  it("should 404 for non-matching custom name", async () => {
    const response = await handleTrackerScript(
      mockRequest,
      createMockEnv("custom"),
      "analytics.js",
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Script not found");
  });
});
