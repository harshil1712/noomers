// Registered-domain + subdomains allowlist for event collection. Blocks
// cross-site pollution via copied snippets; a non-browser client can still
// fake both headers, so SERVER_EVENTS_TOKEN bypasses this entirely.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.includes("/") || (h.includes(":") && !h.startsWith("["))) {
    try {
      h = new URL(h.includes("://") ? h : `https://${h}`).hostname;
    } catch {
      return h;
    }
  }
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h.startsWith("www.")) h = h.slice(4);
  return h;
}

function hostMatches(host: string, domain: string): boolean {
  const h = normalizeHost(host);
  const d = normalizeHost(domain);
  return h === d || h.endsWith(`.${d}`);
}

export function isAllowedEventHost(host: string, siteDomain: string, requestUrl: string): boolean {
  if (hostMatches(host, siteDomain)) return true;
  const self = normalizeHost(requestUrl);
  return LOCAL_HOSTS.has(self) && LOCAL_HOSTS.has(normalizeHost(host));
}

// Returns true when the event must be dropped: Origin (when present) or the
// page host is outside the site's registered domain (+ subdomains).
export function shouldDropForeignHost(
  request: Request,
  pageHost: string,
  siteDomain: string,
): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (!isAllowedEventHost(new URL(origin).hostname, siteDomain, request.url)) return true;
    } catch {
      return true;
    }
  }
  return !isAllowedEventHost(pageHost, siteDomain, request.url);
}
