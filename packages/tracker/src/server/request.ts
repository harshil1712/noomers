import type { CollectRequestParams } from "../shared/types";
import { queryParamStringify } from "../shared/utils";

export async function makeRequest(
    url: string,
    params: CollectRequestParams,
    timeout = 1000,
    userAgent?: string,
): Promise<void> {
    try {
        const query = queryParamStringify(params, true);
        const usePost = Boolean(params.ip || params.en);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(usePost ? url : url + query, {
            method: usePost ? "POST" : "GET",
            headers: {
                "Content-Type": usePost
                    ? "application/x-www-form-urlencoded"
                    : "text/plain",
                "User-Agent": userAgent || "Counterscale-Tracker-Server/3.4.1",
            },
            ...(usePost ? { body: query.slice(1) } : {}),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Consume the response to free up resources
        await response.text();
    } catch {
        // Don't throw - tracking should be fire-and-forget
        // This includes network errors, timeouts, aborts, etc.
    }
}
