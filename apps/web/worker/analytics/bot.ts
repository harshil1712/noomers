import { isbot } from "isbot";

const SERVER_TRACKER_UA_PREFIX = "noomers-tracker-server/";

/**
 * Decide whether a request should be dropped as bot/automated traffic.
 *
 * Policy:
 * - The first-party noomers server tracker UA prefix is explicitly exempt,
 *   because isbot classifies every generic non-browser UA as a bot.
 * - Any other missing or isbot-classified user-agent is dropped.
 * - Requests from known datacenter/hosting ASNs are dropped separately via
 *   `isDatacenterAsn`; isbot only reads the User-Agent, which server-side
 *   traffic can fake.
 *
 * This uses the User-Agent header and the request's ASN. It does not log or
 * persist IPs, ASNs, full user-agents, or other request metadata.
 */
export function shouldDropBot(request: Request): boolean {
  const userAgent = request.headers.get("user-agent") || "";

  if (userAgent.startsWith(SERVER_TRACKER_UA_PREFIX)) {
    return false;
  }

  if (!userAgent) {
    return true;
  }

  return isbot(userAgent);
}

const DATACENTER_ASNS = new Set([
  16509, // Amazon AWS
  14618, // Amazon AWS
  396982, // Google Cloud
  14061, // DigitalOcean
  24940, // Hetzner
  16276, // OVH
  20473, // Vultr (Choopa)
  63949, // Akamai/Linode
  45102, // Alibaba Cloud
  132203, // Tencent Cloud
  150436, // BytePlus
  55960, // Beijing Sinnet / Guanghuan Xinwang
  209709, // trafficforce
  203061, // code200
  201341, // code200
  133499, // REDGIANT
  396319, // CloudVPN
  203020, // HostRoyale
  207990, // HostRoyale
  212238, // FASTPLANET
  39855, // MOD Mission Critical
]);

/**
 * Whether an ASN belongs to a known datacenter/hosting network. Accepts the
 * Cloudflare `request.cf.asn` number or its string form. Used only for the
 * drop decision; never logged or persisted.
 */
export function isDatacenterAsn(asn: number | string | undefined): boolean {
  return DATACENTER_ASNS.has(Number(asn));
}
