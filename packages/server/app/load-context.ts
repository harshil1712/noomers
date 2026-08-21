import { type AppLoadContext } from "react-router";
import { type PlatformProxy } from "wrangler";
import { AnalyticsEngineAPI } from "./analytics/query";
import { R2SQLAPI } from "./analytics/r2-sql";

interface ExtendedEnv extends Env {
    CF_PAGES_COMMIT_SHA: string;
}

type Cloudflare = Omit<PlatformProxy<ExtendedEnv>, "dispose">;

declare module "react-router" {
    interface AppLoadContext {
        cloudflare: Cloudflare;
        analyticsEngine: AnalyticsEngineAPI;
        sessionAnalytics?: R2SQLAPI;
    }
}

type GetLoadContext = (args: {
    request: Request;
    context: { cloudflare: Cloudflare }; // load context _before_ augmentation
}) => AppLoadContext;

// Shared implementation compatible with Vite, Wrangler, and Cloudflare Pages
export const getLoadContext: GetLoadContext = ({ context }) => {
    const analyticsEngine = new AnalyticsEngineAPI(
        context.cloudflare.env.CF_ACCOUNT_ID,
        context.cloudflare.env.CF_BEARER_TOKEN,
        context.cloudflare.env.ANALYTICS_DATASET ?? "metricsDataset",
    );
    const { R2_SQL_BUCKET, R2_SQL_TABLE, R2_SQL_TOKEN } =
        context.cloudflare.env;
    const sessionAnalytics =
        R2_SQL_BUCKET && R2_SQL_TABLE && R2_SQL_TOKEN
            ? new R2SQLAPI(
                  context.cloudflare.env.CF_ACCOUNT_ID,
                  R2_SQL_BUCKET,
                  R2_SQL_TOKEN,
                  R2_SQL_TABLE,
              )
            : undefined;

    return {
        ...context,
        analyticsEngine: analyticsEngine,
        sessionAnalytics,
    };
};
