import { type AppLoadContext } from "react-router";
import { type PlatformProxy } from "wrangler";
import { R2SQLAPI } from "./analytics/r2-sql";

interface ExtendedEnv extends Env {
    CF_PAGES_COMMIT_SHA: string;
}

type Cloudflare = Omit<PlatformProxy<ExtendedEnv>, "dispose">;

export class BasinNotConfiguredError extends Error {
    constructor() {
        super("Basin SQL is not configured (R2_SQL_* env vars missing)");
        this.name = "BasinNotConfiguredError";
    }
}

declare module "react-router" {
    interface AppLoadContext {
        cloudflare: Cloudflare;
        /** Throws BasinNotConfiguredError when Basin env vars are absent. */
        sessionAnalytics(): R2SQLAPI;
        readonly basinConfigured: boolean;
    }
}

type GetLoadContext = (args: {
    request: Request;
    context: { cloudflare: Cloudflare }; // load context _before_ augmentation
}) => AppLoadContext;

// Shared implementation compatible with Vite, Wrangler, and Cloudflare Pages
export const getLoadContext: GetLoadContext = ({ context }) => {
    const { R2_SQL_BUCKET, R2_SQL_TABLE, R2_SQL_TOKEN, R2_SQL_IMPORT_TABLE } =
        context.cloudflare.env;
    const basinConfigured = Boolean(
        R2_SQL_BUCKET && R2_SQL_TABLE && R2_SQL_TOKEN,
    );
    let api: R2SQLAPI | undefined;
    const sessionAnalytics = () => {
        if (!basinConfigured) throw new BasinNotConfiguredError();
        api ??= new R2SQLAPI(
            context.cloudflare.env.CF_ACCOUNT_ID,
            R2_SQL_BUCKET!,
            R2_SQL_TOKEN!,
            R2_SQL_TABLE!,
            fetch,
            R2_SQL_IMPORT_TABLE || undefined,
            (promise) => context.cloudflare.ctx.waitUntil(promise),
        );
        return api;
    };

    return {
        ...context,
        sessionAnalytics,
        basinConfigured,
    };
};
