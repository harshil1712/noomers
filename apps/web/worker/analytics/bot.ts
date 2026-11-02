import { isbot } from "isbot";

const SERVER_TRACKER_UA_PREFIX = "noomers-tracker-server/";

/**
 * Decide whether a request should be dropped as bot/automated traffic.
 *
 * Policy:
 * - The first-party noomers server tracker UA prefix is explicitly exempt,
 *   because isbot classifies every generic non-browser UA as a bot.
 * - Any other missing or isbot-classified user-agent is dropped.
 *
 * This uses only the User-Agent header. It does not log or persist IPs, full
 * user-agents, or other request metadata.
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
