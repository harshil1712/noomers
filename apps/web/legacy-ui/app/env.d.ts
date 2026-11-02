declare namespace Cloudflare {
    interface Env {
        CF_BEARER_TOKEN: string;
        CF_ACCOUNT_ID: string;
        CF_JWT_SECRET: string;
        CF_PASSWORD_HASH: string;
        CF_AUTH_ENABLED: string;
        CF_TRACKER_SCRIPT_NAME: string;
        CF_STORAGE_ENABLED: string;
        VISITOR_SALT: string;
        SERVER_EVENTS_TOKEN?: string;
        COLLECT_RATE_LIMIT: RateLimit;
        STATS_API_TOKEN?: string;
        SITES_API_TOKEN?: string;
        R2_SQL_BUCKET?: string;
        R2_SQL_TABLE?: string;
        R2_SQL_TOKEN?: string;
        R2_SQL_IMPORT_TABLE?: string;
    }
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Env extends Cloudflare.Env {}
