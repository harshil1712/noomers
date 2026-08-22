import { test, expect, type Request } from "@playwright/test";

test("includes scroll depth with correct prior-page attribution", async ({
    page,
}) => {
    const collectRequests: Request[] = [];
    const onRequest = (request: Request) => {
        if (request.url().includes("/collect")) {
            collectRequests.push(request);
        }
    };
    page.on("request", onRequest);

    await page.goto("http://localhost:3004/06_scrollDepth/");

    // Wait for the initial pageview (and any cache request) to be observed.
    await expect.poll(
        () => collectRequests.filter((request) => request.method() === "GET")
            .length,
    ).toBeGreaterThanOrEqual(1);

    // Scroll to the bottom of the tall page so the maximum depth exceeds the
    // initial viewport depth.
    await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
    });

    // Synchronize with the throttled requestAnimationFrame handler so the new
    // maximum depth sample is recorded before the SPA transition.
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve()),
                ),
            ),
    );

    await page.click("button");

    // Wait for the engagement flush and the new pageview to be observed.
    await expect.poll(
        () => collectRequests.filter((request) => request.method() === "POST")
            .length,
    ).toBe(1);
    await expect.poll(
        () => collectRequests.filter((request) => request.method() === "GET")
            .length,
    ).toBe(2);

    page.off("request", onRequest);

    const engagementRequests = collectRequests.filter(
        (request) => request.method() === "POST",
    );

    // Exactly one engagement event should be emitted for the SPA transition,
    // not a stream of scroll-only heartbeats.
    expect(engagementRequests.length).toBe(1);

    const engagement = engagementRequests[0];
    const engagementBody = (await engagement.postData()) || "";
    const engagementParams = new URLSearchParams(engagementBody);
    expect(engagementParams.get("et")).toBe("engagement");
    expect(engagementParams.get("p")).toBe("/06_scrollDepth/");

    const depth = Number(engagementParams.get("sd"));
    expect(Number.isInteger(depth)).toBe(true);
    expect(depth).toBeGreaterThan(0);
    expect(depth).toBeLessThanOrEqual(100);

    const pageviewRequests = collectRequests.filter(
        (request) => request.method() === "GET",
    );
    const secondPageview = pageviewRequests.find((request) =>
        decodeURIComponent(request.url()).includes("/06_scrollDepth/part_2"),
    );
    expect(secondPageview).toBeTruthy();

    // The engagement for the previous page should be sent before the new
    // pageview so scroll depth is attributed to the correct path.
    const engagementIndex = collectRequests.indexOf(engagement);
    const secondPageviewIndex = collectRequests.indexOf(secondPageview!);
    expect(engagementIndex).toBeLessThan(secondPageviewIndex);
});
