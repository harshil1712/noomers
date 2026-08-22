import { test, expect, type Request } from "@playwright/test";

test("flushes engagement delta before SPA pageview navigation", async ({
    page,
}) => {
    const collectRequests: Request[] = [];
    page.on("request", (request) => {
        if (request.url().includes("/collect")) {
            collectRequests.push(request);
        }
    });

    await page.goto("http://localhost:3004/05_engagementLifecycle/");

    // Wait for the initial pageview (and any cache request) to settle.
    await page.waitForTimeout(500);

    // Allow enough visible time for the engagement delta to exceed the 1s
    // minimum threshold.
    await page.waitForTimeout(1500);

    await page.click("button");

    // Wait for the engagement flush and the new pageview to be sent.
    await page.waitForTimeout(500);

    const engagementRequests = collectRequests.filter(
        (request) => request.method() === "POST",
    );
    expect(engagementRequests.length).toBeGreaterThanOrEqual(1);

    const engagement = engagementRequests[0];
    expect(engagement).toBeTruthy();
    const engagementBody = (await engagement.postData()) || "";
    const engagementParams = new URLSearchParams(engagementBody);
    expect(engagementParams.get("et")).toBe("engagement");
    expect(Number(engagementParams.get("e"))).toBeGreaterThanOrEqual(1000);
    expect(engagementParams.get("p")).toBe("/05_engagementLifecycle/");

    const pageviewRequests = collectRequests.filter(
        (request) => request.method() === "GET",
    );
    expect(pageviewRequests.length).toBeGreaterThanOrEqual(2);

    const secondPageview = pageviewRequests.find((request) =>
        decodeURIComponent(request.url()).includes(
            "/05_engagementLifecycle/part_2",
        ),
    );
    expect(secondPageview).toBeTruthy();
    const secondUrl = secondPageview!.url();
    const secondParams = new URLSearchParams(secondUrl.split("?")[1]);
    expect(decodeURIComponent(secondParams.get("p") || "")).toBe(
        "/05_engagementLifecycle/part_2",
    );

    // The engagement for the previous page should be sent before the new
    // pageview so the delta is attributed to the correct path.
    const engagementIndex = collectRequests.indexOf(engagement);
    const secondPageviewIndex = collectRequests.indexOf(secondPageview!);
    expect(engagementIndex).toBeLessThan(secondPageviewIndex);
});
