import {
  normalizeEvent,
  readCollectBody,
  recordNormalizedEvent,
  collectionStatusResponse,
  getSiteCollectionStatus,
  type CollectEnv,
  type EventInput,
} from "./collect";
import { hasServerEventsToken } from "./server-token";
import { shouldDropBot } from "./bot";
import { shouldDropForeignHost } from "./hostname";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
};
const MAX_EVENT_BODY_BYTES = 128 * 1024;

const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function getValue(payload: Record<string, unknown>, longName: string, shortName: string): unknown {
  return payload[longName] ?? payload[shortName];
}

function getRequiredString(
  payload: Record<string, unknown>,
  longName: string,
  shortName: string,
): string | null {
  const value = getValue(payload, longName, shortName);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeProperties(value: unknown): string | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return "";

  const entries = Object.entries(value).filter(([, propertyValue]) => {
    return (
      ["string", "boolean"].includes(typeof propertyValue) ||
      (typeof propertyValue === "number" && Number.isFinite(propertyValue))
    );
  });
  const retained = entries.slice(0, 30);
  if (
    retained.some(
      ([key, propertyValue]) => byteLength(key) > 300 || byteLength(String(propertyValue)) > 2000,
    )
  ) {
    return null;
  }
  return JSON.stringify(Object.fromEntries(retained));
}

function normalizeRevenue(value: unknown): {
  amount?: string;
  currency?: string;
} {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};

  const revenue = value as Record<string, unknown>;
  const currency = typeof revenue.currency === "string" ? revenue.currency.toUpperCase() : "";
  const amount =
    typeof revenue.amount === "string" || typeof revenue.amount === "number"
      ? String(revenue.amount)
      : "";

  if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(Number(amount))) {
    return {};
  }
  return { amount, currency };
}

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseUrl(
  value: string,
  hashBasedRouting: boolean,
): {
  sanitizedUrl: string;
  hostname: string;
  pathname: string;
  searchParams: URLSearchParams;
} | null {
  try {
    const relative = value.startsWith("/");
    const parsed = new URL(value, "https://relative.invalid");
    if (!relative && !/^[a-z][a-z\d+.-]*:/i.test(value)) return null;
    if (parsed.protocol === "data:") return null;
    const fragment = hashBasedRouting ? decodeUrlPart(parsed.hash) : "";
    const pathname = `${decodeUrlPart(parsed.pathname || "/")}${fragment}`.trimEnd();
    if (pathname.length > 2000) return null;
    return {
      sanitizedUrl:
        !relative && parsed.host ? `${parsed.protocol}//${parsed.host}${pathname}` : pathname,
      hostname: relative ? "(none)" : parsed.hostname,
      pathname,
      searchParams: parsed.searchParams,
    };
  } catch {
    return null;
  }
}

function isValidIp(value: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255);
  }
  if (!value.includes(":")) return false;
  try {
    new URL(`http://[${value}]`);
    return true;
  } catch {
    return false;
  }
}

async function getClientIp(request: Request, trusted: boolean): Promise<string | undefined> {
  if (trusted) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const firstValid = forwarded
        .split(",")
        .map((value) => value.trim())
        .find(isValidIp);
      if (firstValid) return firstValid;
    }
  }

  const connectingIp = request.headers.get("cf-connecting-ip");
  return connectingIp && isValidIp(connectingIp) ? connectingIp : undefined;
}

function sanitizeReferrer(value: unknown): string {
  if (typeof value !== "string" || !value) return "";

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return `${url.origin}${url.pathname}`.slice(0, 2000);
  } catch {
    return "";
  }
}

function parsePayload(payload: unknown, suppliedIp?: string): EventInput | null {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return null;
  }

  const body = payload as Record<string, unknown>;
  const siteId = getRequiredString(body, "domain", "d");
  const eventName = getRequiredString(body, "name", "n");
  const url = getRequiredString(body, "url", "u");
  if (!siteId || !eventName || eventName.length > 120 || !url) return null;

  const hashBasedRouting = body.hashBasedRouting === true || body.h === 1;
  const parsedUrl = parseUrl(url, hashBasedRouting);
  if (!parsedUrl) return null;

  const eventType =
    eventName === "pageview" ? "pageview" : eventName === "engagement" ? "engagement" : "custom";
  const revenue = normalizeRevenue(getValue(body, "revenue", "$"));
  const referrer = getValue(body, "referrer", "r");
  const engagementTime = getValue(body, "engagement_time", "e");
  const scrollDepth = getValue(body, "scroll_depth", "sd");
  const interactive = getValue(body, "interactive", "i");
  const eventProperties = normalizeProperties(getValue(body, "props", "p"));
  if (eventProperties === null) return null;

  const normalizedEngagementTime =
    typeof engagementTime === "number" &&
    Number.isFinite(engagementTime) &&
    engagementTime > 0 &&
    engagementTime < 30 * 24 * 60 * 60 * 1000
      ? engagementTime
      : 0;
  const normalizedScrollDepth =
    typeof scrollDepth === "number" && Number.isFinite(scrollDepth)
      ? Math.min(100, Math.max(0, scrollDepth))
      : 255;
  if (
    eventType === "engagement" &&
    normalizedEngagementTime === 0 &&
    normalizedScrollDepth === 255
  ) {
    return null;
  }
  const params = parsedUrl.searchParams;

  return {
    siteId,
    eventType,
    eventName,
    eventProperties,
    url: parsedUrl.sanitizedUrl,
    host: parsedUrl.hostname,
    path: parsedUrl.pathname,
    referrer: sanitizeReferrer(referrer),
    interactive: interactive !== false,
    revenueAmount: revenue.amount,
    revenueCurrency: revenue.currency,
    engagementTime: normalizedEngagementTime,
    scrollDepth: normalizedScrollDepth,
    suppliedIp,
    utmSource: params.get("utm_source") || params.get("source") || params.get("ref") || "",
    utmMedium: params.get("utm_medium") || "",
    utmCampaign: params.get("utm_campaign") || "",
    utmTerm: params.get("utm_term") || "",
    utmContent: params.get("utm_content") || "",
  };
}

export async function plausibleEventRequestHandler(
  request: Request,
  env: CollectEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  extra: Record<string, string> = {},
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Debug-Request",
        "Access-Control-Max-Age": "1728000",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS" },
    });
  }

  if (!env.VISITOR_SALT) {
    console.error("VISITOR_SALT is not configured; refusing collection");
    return new Response("Service misconfigured", {
      status: 503,
      headers: CORS_HEADERS,
    });
  }
  const trusted = await hasServerEventsToken(request, env);
  const clientIp = await getClientIp(request, trusted);
  if (request.headers.get("x-debug-request") === "true") {
    return new Response(clientIp || "", {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "no-store",
        "Content-Type": "text/plain",
      },
    });
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (!["application/json", "text/plain"].includes(contentType || "")) {
    return new Response("Unsupported Media Type", {
      status: 415,
      headers: CORS_HEADERS,
    });
  }

  const body = await readCollectBody(request, MAX_EVENT_BODY_BYTES);
  if (body === null) {
    return new Response("Request body is too large", {
      status: 413,
      headers: CORS_HEADERS,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  const input = parsePayload(payload, clientIp);
  if (!input) {
    return new Response("Invalid event", {
      status: 400,
      headers: CORS_HEADERS,
    });
  }
  const effectiveIp = (await getClientIp(request, trusted)) || "unknown";
  const limited = await env.COLLECT_RATE_LIMIT?.limit({
    key: `${effectiveIp}:${input.siteId}`,
  });
  if (limited && !limited.success) {
    return new Response("Rate limit exceeded", {
      status: 429,
      headers: CORS_HEADERS,
    });
  }
  const statusResponse = collectionStatusResponse(
    await getSiteCollectionStatus(env, input.siteId),
    CORS_HEADERS,
  );
  if (statusResponse) return statusResponse;

  const droppedResponse = () =>
    new Response("ok", {
      status: 202,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
        "x-plausible-dropped": "1",
      },
    });

  if (shouldDropBot(request)) {
    return droppedResponse();
  }

  if (!trusted && shouldDropForeignHost(request, input.url ?? "", input.siteId)) {
    return droppedResponse();
  }

  const event = await normalizeEvent(request, env, input, extra);
  try {
    await recordNormalizedEvent(env, event, ctx);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "event recording failed",
        eventType: input.eventType,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return new Response("Event recording failed", {
      status: 500,
      headers: CORS_HEADERS,
    });
  }

  return new Response("ok", {
    status: 202,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
