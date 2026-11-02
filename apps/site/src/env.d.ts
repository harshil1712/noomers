/// <reference path="../.astro/types.d.ts" />
declare module "#project" {
  export const PROJECT: {
    name: string;
    productName: string;
    domain: string;
    appSubdomain: string;
    emailFrom: string;
    apiKeyPrefix: string;
    api: { publicSpec: boolean; rateLimitPerMinute: number };
  };
  export const APP_DOMAIN: string;
}
