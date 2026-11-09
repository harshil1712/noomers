#!/usr/bin/env node
// Live end-to-end check against a deployed noomers instance.
//
// Registers a throwaway site, sends a fixed set of events through both
// collection paths (native /collect and Plausible /api/event), waits for
// Basin Pipelines to flush, then asserts the Stats API returns exactly the
// numbers that dataset implies. Finally deletes the site and checks that
// collection and stats are refused for it.
//
// Usage:
//   SITES_API_TOKEN=… STATS_API_TOKEN=… node scripts/live-check.mjs
// Optional env:
//   NOOMERS_APP_URL   default https://app.noomers.com
//   LIVECHECK_DOMAIN  default livecheck.noomers.com (the test site is r<run>.<this>)
//   LIVECHECK_TIMEOUT_S  how long to wait for Basin, default 720
//   LIVECHECK_KEEP=1  keep the test site instead of deleting it
//
// The test site's rows stay in Iceberg (unqueryable once the site is
// deleted) until erased with scripts/iceberg-erasure/erase.py.

const APP = (process.env.NOOMERS_APP_URL || "https://app.noomers.com").replace(/\/$/, "");
const SITES_TOKEN = required("SITES_API_TOKEN");
const STATS_TOKEN = required("STATS_API_TOKEN");
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DOMAIN = `r${RUN}.${process.env.LIVECHECK_DOMAIN || "livecheck.noomers.com"}`;
const ORIGIN = `https://${DOMAIN}`;
const TIMEOUT_MS = Number(process.env.LIVECHECK_TIMEOUT_S || 720) * 1000;
const RANGE = [iso(Date.now() - 60_000), iso(Date.now() + 60 * 60_000)];

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`missing required environment variable: ${name}`);
    process.exit(2);
  }
  return value;
}

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Distinct UAs make distinct visitors (the visitor hash includes the UA).
// The server-tracker prefix is exempt from bot filtering.
const ua = (visitor) => `noomers-tracker-server/live-check (${RUN}-${visitor})`;

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
  return ok;
}
function checkRange(name, actual, min, max) {
  const ok = typeof actual === "number" && actual >= min && actual <= max;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? ` (${actual})` : `  expected ${min}..${max}, got ${JSON.stringify(actual)}`}`,
  );
}

async function sitesApi(method, path, body) {
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: { Authorization: `Bearer ${SITES_TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function stats(query, token = STATS_TOKEN) {
  const res = await fetch(`${APP}/api/v2/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ site_id: DOMAIN, date_range: RANGE, ...query }),
  });
  const text = await res.text();
  return { status: res.status, body: res.ok ? JSON.parse(text) : text };
}

async function statsRows(query) {
  const { status, body } = await stats(query);
  if (status !== 200)
    throw new Error(`stats ${JSON.stringify(query)} -> ${status} ${String(body).slice(0, 200)}`);
  return body.results;
}

// Native tracker: GET for pageviews/custom events, POST body for engagement.
async function native(visitor, params, { method = "GET", headers = {} } = {}) {
  const qs = new URLSearchParams({ sid: DOMAIN, h: ORIGIN, ...params }).toString();
  const res = await fetch(method === "GET" ? `${APP}/collect?${qs}` : `${APP}/collect`, {
    method,
    headers: {
      "User-Agent": ua(visitor),
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...headers,
    },
    body: method === "POST" ? qs : undefined,
  });
  await res.arrayBuffer();
  return { status: res.status, dropped: res.headers.get("x-noomers-dropped") === "1" };
}

// Plausible-compatible Events API.
async function plausible(visitor, payload, headers = {}) {
  const res = await fetch(`${APP}/api/event`, {
    method: "POST",
    headers: { "User-Agent": ua(visitor), "Content-Type": "text/plain", ...headers },
    body: JSON.stringify({ domain: DOMAIN, referrer: "", ...payload }),
  });
  await res.text();
  return { status: res.status, dropped: res.headers.get("x-plausible-dropped") === "1" };
}

function accepted(name, result, okStatus) {
  check(
    `${name} accepted`,
    { status: result.status, dropped: result.dropped },
    { status: okStatus, dropped: false },
  );
}

async function sendDataset() {
  console.log(`\n# Sending events for ${DOMAIN}`);
  // v1: one native pageview → a bounce.
  accepted(
    "v1 pageview /",
    await native("v1", { p: "/", r: "https://news.ycombinator.com/", ht: "1" }),
    200,
  );
  // v2: two native pageviews 3s apart → not a bounce, ~3s visit, entry / exit /pricing.
  accepted("v2 pageview /", await native("v2", { p: "/", ht: "1" }), 200);
  await sleep(3000);
  accepted("v2 pageview /pricing", await native("v2", { p: "/pricing" }), 200);
  // v3: Plausible pageview, then a revenue event 2s later.
  accepted(
    "v3 pageview /docs",
    await plausible("v3", { name: "pageview", url: `${ORIGIN}/docs` }),
    202,
  );
  await sleep(2000);
  accepted(
    "v3 Signup (revenue)",
    await plausible("v3", {
      name: "Signup",
      url: `${ORIGIN}/docs`,
      props: { plan: "pro" },
      revenue: { amount: "10.50", currency: "USD" },
    }),
    202,
  );
  // v4: native pageview, then a native custom event 1s later.
  accepted("v4 pageview /pricing", await native("v4", { p: "/pricing", ht: "1" }), 200);
  await sleep(1000);
  accepted(
    "v4 Signup",
    await native("v4", { p: "/pricing", en: "Signup", ep: JSON.stringify({ plan: "free" }) }),
    200,
  );
  // v5: native pageview + engagement; engagement isn't interactive → still a bounce.
  accepted("v5 pageview /", await native("v5", { p: "/", ht: "1" }), 200);
  accepted(
    "v5 engagement",
    await native("v5", { p: "/", et: "engagement", e: "5000", sd: "80" }, { method: "POST" }),
    200,
  );

  console.log("\n# Events that must be refused or dropped");
  const foreignOrigin = await native(
    "x1",
    { p: "/", ht: "1" },
    { headers: { Origin: "https://evil.example" } },
  );
  check("foreign Origin dropped", foreignOrigin, { status: 200, dropped: true });
  const foreignHost = await plausible("x2", { name: "pageview", url: "https://evil.example/" });
  check("foreign page host dropped", foreignHost, { status: 202, dropped: true });
  const botRes = await fetch(
    `${APP}/collect?${new URLSearchParams({ sid: DOMAIN, h: ORIGIN, p: "/", ht: "1" })}`,
    {
      headers: { "User-Agent": "curl/8.5.0" },
    },
  );
  await botRes.arrayBuffer();
  check("bot UA dropped", botRes.headers.get("x-noomers-dropped"), "1");
  const unknown = await fetch(
    `${APP}/collect?${new URLSearchParams({ sid: `nope-${DOMAIN}`, h: `https://nope-${DOMAIN}`, p: "/" })}`,
    {
      headers: { "User-Agent": ua("x3") },
    },
  );
  await unknown.arrayBuffer();
  check("unregistered site rejected", unknown.status, 404);
  check(
    "Stats API without token rejected",
    (await stats({ metrics: ["visitors"] }, "wrong")).status,
    401,
  );
}

async function waitForBasin() {
  console.log(`\n# Waiting up to ${TIMEOUT_MS / 1000}s for Basin (sink rolls every ~5 min)`);
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const { status, body } = await stats({ metrics: ["pageviews", "events"] });
    const m = status === 200 ? body.results[0]?.metrics : null;
    if (m && m[0] >= 6 && m[1] >= 8) return true;
    if (Date.now() > deadline) {
      console.log(`timed out; last response ${status} ${JSON.stringify(m ?? body).slice(0, 200)}`);
      return false;
    }
    await sleep(30_000);
  }
}

const byDim = (rows) => Object.fromEntries(rows.map((r) => [r.dimensions[0], r.metrics]));

async function assertStats() {
  console.log("\n# Aggregate metrics");
  const [agg] = await statsRows({
    metrics: [
      "visitors",
      "visits",
      "pageviews",
      "events",
      "views_per_visit",
      "bounce_rate",
      "visit_duration",
    ],
  });
  const [visitors, visits, pageviews, events, viewsPerVisit, bounceRate, duration] = agg.metrics;
  check("visitors", visitors, 5);
  check("visits", visits, 5);
  check("pageviews", pageviews, 6);
  check("events (pageviews + custom, no engagement)", events, 8);
  check("views_per_visit", viewsPerVisit, 1.2);
  check("bounce_rate", bounceRate, 40);
  // (3s + 2s + 1s) / 5 visits, plus request latency, rounded.
  checkRange("visit_duration (s)", duration, 1, 2);

  console.log("\n# Breakdowns");
  check(
    "event:page pageviews",
    byDim(await statsRows({ metrics: ["pageviews"], dimensions: ["event:page"] })),
    { "/": [3], "/pricing": [2], "/docs": [1] },
  );
  check(
    "event:page visitors",
    byDim(await statsRows({ metrics: ["visitors"], dimensions: ["event:page"] })),
    { "/": [3], "/pricing": [2], "/docs": [1] },
  );
  check(
    "event:hostname is the bare host on both paths",
    byDim(await statsRows({ metrics: ["visitors"], dimensions: ["event:hostname"] })),
    { [DOMAIN]: [5] },
  );
  check(
    "visit:entry_page visits",
    byDim(await statsRows({ metrics: ["visits"], dimensions: ["visit:entry_page"] })),
    { "/": [3], "/pricing": [1], "/docs": [1] },
  );
  check(
    "visit:exit_page visits",
    byDim(await statsRows({ metrics: ["visits"], dimensions: ["visit:exit_page"] })),
    { "/": [2], "/pricing": [2], "/docs": [1] },
  );
  check(
    "event:props:plan visitors",
    byDim(await statsRows({ metrics: ["visitors"], dimensions: ["event:props:plan"] })),
    { pro: [1], free: [1] },
  );
  const hourly = await statsRows({ metrics: ["pageviews"], dimensions: ["time:hour"] });
  check(
    "time:hour pageviews sum",
    hourly.reduce((s, r) => s + r.metrics[0], 0),
    6,
  );

  console.log("\n# Filters");
  const [pricing] = await statsRows({
    metrics: ["visitors", "pageviews"],
    filters: [["is", "event:page", ["/pricing"]]],
  });
  check("filter event:page is /pricing", pricing.metrics, [2, 2]);
  const [signups] = await statsRows({
    metrics: ["events"],
    filters: [["is", "event:name", ["Signup"]]],
  });
  check("filter event:name is Signup", signups.metrics, [2]);

  console.log("\n# Goals and revenue");
  const goals = byDim(
    await statsRows({
      metrics: ["visitors", "events", "conversion_rate", "total_revenue"],
      dimensions: ["event:goal"],
    }),
  );
  check("goal Visit /pricing", goals["Visit /pricing"]?.slice(0, 3), [2, 2, 40]);
  check("goal Signup", goals.Signup?.slice(0, 3), [2, 2, 40]);
  check("goal Signup total_revenue", goals.Signup?.[3]?.value, 10.5);
  check("goal Signup currency", goals.Signup?.[3]?.currency, "USD");
}

async function assertDeleted() {
  console.log("\n# After deletion");
  const res = await fetch(
    `${APP}/collect?${new URLSearchParams({ sid: DOMAIN, h: ORIGIN, p: "/", ht: "1" })}`,
    {
      headers: { "User-Agent": ua("v9") },
    },
  );
  await res.arrayBuffer();
  check("collection for a deleted site", res.status, 410);
  check("Stats API for a deleted site", (await stats({ metrics: ["visitors"] })).status, 404);
}

let created = false;
try {
  console.log(`# Live check against ${APP}`);
  await sitesApi("POST", "/api/v1/sites", { domain: DOMAIN, timezone: "Etc/UTC" });
  created = true;
  await sitesApi("PUT", "/api/v1/sites/goals", {
    site_id: DOMAIN,
    goal_type: "page",
    page_path: "/pricing",
  });
  await sitesApi("PUT", "/api/v1/sites/goals", {
    site_id: DOMAIN,
    goal_type: "event",
    event_name: "Signup",
    currency: "USD",
  });
  await sendDataset();
  if (await waitForBasin()) await assertStats();
  else failures++;
} catch (error) {
  failures++;
  console.log(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (created && process.env.LIVECHECK_KEEP !== "1") {
    try {
      await sitesApi("DELETE", `/api/v1/sites/${encodeURIComponent(DOMAIN)}`);
      await assertDeleted();
    } catch (error) {
      failures++;
      console.log(`FAIL  cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

console.log(
  `\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`} (site ${DOMAIN})`,
);
process.exit(failures === 0 ? 0 : 1);
