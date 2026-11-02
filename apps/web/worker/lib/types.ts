export interface SearchFilters {
    host?: string;
    path?: string;
    name?: string;
    referrer?: string;
    deviceModel?: string;
    deviceType?: string;
    country?: string;
    browserName?: string;
    browserVersion?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmTerm?: string;
    utmContent?: string;
}

export interface User {
    authenticated: boolean;
}
