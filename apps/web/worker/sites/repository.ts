export interface TrackerScriptConfiguration {
    installation_type: "wordpress" | "manual" | "gtm" | null;
    track_404_pages: boolean;
    hash_based_routing: boolean;
    outbound_links: boolean;
    file_downloads: boolean;
    revenue_tracking: boolean;
    tagged_events: boolean;
    form_submissions: boolean;
    pageview_props: boolean;
}

export interface Site {
    domain: string;
    trackerId: string;
    plausibleScriptId?: string | null;
    timezone: string;
    customProperties: string[];
    trackerScriptConfiguration: TrackerScriptConfiguration;
}

interface SiteRow {
    domain: string;
    tracker_id: string;
    plausible_script_id?: string | null;
    timezone: string;
    custom_properties?: string;
    tracker_script_configuration: string;
}

export type SiteCollectionStatus = "active" | "deleted" | "unknown";

interface SiteCollectionStatusRow {
    status: SiteCollectionStatus;
}

const DEFAULT_TRACKER_CONFIGURATION: TrackerScriptConfiguration = {
    installation_type: null,
    track_404_pages: false,
    hash_based_routing: false,
    outbound_links: false,
    file_downloads: false,
    revenue_tracking: false,
    tagged_events: false,
    form_submissions: false,
    pageview_props: false,
};

function normalizeDomain(value: string): string {
    const domain = value.trim().toLowerCase();
    if (!domain || domain.length > 253 || /[\s/:]/.test(domain)) {
        throw new Error("A valid domain is required.");
    }
    return domain;
}

function normalizeTimezone(value?: string): string {
    const timezone = value?.trim() || "Etc/UTC";
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    } catch {
        throw new Error("A valid IANA timezone is required.");
    }
    return timezone;
}

function mergeTrackerConfiguration(
    current: TrackerScriptConfiguration,
    input?: Partial<TrackerScriptConfiguration>,
): TrackerScriptConfiguration {
    if (!input) return current;
    const result = { ...current };
    for (const [key, value] of Object.entries(input)) {
        if (!Object.hasOwn(DEFAULT_TRACKER_CONFIGURATION, key)) {
            throw new Error(`Unknown tracker script option: ${key}`);
        }
        if (key === "installation_type") {
            if (!["wordpress", "manual", "gtm", null].includes(value as never)) {
                throw new Error("Invalid installation_type.");
            }
        } else if (typeof value !== "boolean") {
            throw new Error(`Tracker script option ${key} must be a boolean.`);
        }
        Object.assign(result, { [key]: value });
    }
    return result;
}

function toSite(row: SiteRow): Site {
    let stored: Partial<TrackerScriptConfiguration> = {};
    let customProperties: string[] = [];
    try {
        stored = JSON.parse(row.tracker_script_configuration);
    } catch {
        stored = {};
    }
    try {
        customProperties = JSON.parse(row.custom_properties || "[]");
    } catch {
        customProperties = [];
    }
    return {
        domain: row.domain,
        trackerId: row.tracker_id,
        plausibleScriptId: row.plausible_script_id ?? null,
        timezone: row.timezone,
        customProperties,
        trackerScriptConfiguration: mergeTrackerConfiguration(
            DEFAULT_TRACKER_CONFIGURATION,
            stored,
        ),
    };
}

export const PLAUSIBLE_SCRIPT_ID_PATTERN = /^pa-[A-Za-z0-9_-]{8,64}$/;

export function validatePlausibleScriptId(
    value: string | null | undefined,
): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (!PLAUSIBLE_SCRIPT_ID_PATTERN.test(value)) {
        throw new Error(
            "plausible_script_id must match pa-[A-Za-z0-9_-]{8,64}",
        );
    }
    return value;
}

export class SitesRepository {
    constructor(private database: D1Database) {}

    async getByPlausibleScriptId(scriptId: string): Promise<Site | null> {
        const row = await this.database
            .prepare(
                `SELECT domain, tracker_id, plausible_script_id, timezone,
                        tracker_script_configuration, '[]' AS custom_properties
                 FROM sites WHERE plausible_script_id = ?`,
            )
            .bind(scriptId)
            .first<SiteRow>();
        return row ? toSite(row) : null;
    }

    async get(domain: string): Promise<Site | null> {
        const row = await this.database
            .prepare(
                `SELECT domain, tracker_id, plausible_script_id, timezone, tracker_script_configuration,
                    COALESCE((
                        SELECT json_group_array(property) FROM (
                            SELECT property FROM custom_properties
                            WHERE site_id = sites.domain ORDER BY property
                        )
                    ), '[]') AS custom_properties
                 FROM sites WHERE domain = ?`,
            )
            .bind(normalizeDomain(domain))
            .first<SiteRow>();
        return row ? toSite(row) : null;
    }

    async collectionStatus(domain: string): Promise<SiteCollectionStatus> {
        let normalized: string;
        try {
            normalized = normalizeDomain(domain);
        } catch {
            return "unknown";
        }
        const row = await this.database
            .prepare(
                `SELECT CASE
                    WHEN EXISTS (SELECT 1 FROM site_tombstones WHERE domain = ?1) THEN 'deleted'
                    WHEN EXISTS (SELECT 1 FROM sites WHERE domain = ?1) THEN 'active'
                    ELSE 'unknown'
                 END AS status`,
            )
            .bind(normalized)
            .first<SiteCollectionStatusRow>();
        return row?.status ?? "unknown";
    }

    async list(input: { after?: string; before?: string; limit?: number } = {}) {
        const limit = input.limit ?? 100;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new Error("limit must be between 1 and 100.");
        }
        if (input.after && input.before) {
            throw new Error("Use either after or before, not both.");
        }
        const cursor = input.after || input.before;
        const operator = input.before ? "<" : ">";
        const direction = input.before ? "DESC" : "ASC";
        const statement = this.database.prepare(
            `SELECT domain, tracker_id, plausible_script_id, timezone, tracker_script_configuration,
                COALESCE((
                    SELECT json_group_array(property) FROM (
                        SELECT property FROM custom_properties
                        WHERE site_id = sites.domain ORDER BY property
                    )
                ), '[]') AS custom_properties
             FROM sites
             ${cursor ? `WHERE domain ${operator} ?` : ""}
             ORDER BY domain ${direction} LIMIT ?`,
        );
        const result = cursor
            ? await statement.bind(cursor, limit + 1).all<SiteRow>()
            : await statement.bind(limit + 1).all<SiteRow>();
        const hasMore = result.results.length > limit;
        let rows = result.results.slice(0, limit);
        if (input.before) rows = rows.reverse();
        return {
            sites: rows.map(toSite),
            after: input.before
                ? rows.at(-1)?.domain || null
                : hasMore
                  ? rows.at(-1)?.domain || null
                  : null,
            before: input.before
                ? hasMore
                    ? rows[0]?.domain || null
                    : null
                : input.after
                  ? rows[0]?.domain || null
                  : null,
            limit,
        };
    }

    async create(input: {
        domain: string;
        timezone?: string;
        plausibleScriptId?: string | null;
        trackerScriptConfiguration?: Partial<TrackerScriptConfiguration>;
    }): Promise<Site> {
        const site: Site = {
            domain: normalizeDomain(input.domain),
            trackerId: crypto.randomUUID(),
            plausibleScriptId: input.plausibleScriptId ?? null,
            timezone: normalizeTimezone(input.timezone),
            customProperties: [],
            trackerScriptConfiguration: mergeTrackerConfiguration(
                DEFAULT_TRACKER_CONFIGURATION,
                input.trackerScriptConfiguration,
            ),
        };
        const tombstone = await this.database
            .prepare("SELECT domain FROM site_tombstones WHERE domain = ?")
            .bind(site.domain)
            .first();
        if (tombstone) {
            throw new Error("A deleted domain cannot be registered again.");
        }
        await this.database
            .prepare(
                `INSERT INTO sites (domain, tracker_id, plausible_script_id, timezone, tracker_script_configuration)
                 VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(
                site.domain,
                site.trackerId,
                site.plausibleScriptId ?? null,
                site.timezone,
                JSON.stringify(site.trackerScriptConfiguration),
            )
            .run();
        return site;
    }

    async update(
        currentDomain: string,
        input: {
            domain?: string;
            timezone?: string;
            trackerScriptConfiguration?: Partial<TrackerScriptConfiguration>;
            plausibleScriptId?: string | null;
        },
    ): Promise<Site | null> {
        const current = await this.get(currentDomain);
        if (!current) return null;
        if (input.domain && normalizeDomain(input.domain) !== current.domain) {
            throw new Error("Changing a site's domain is not supported.");
        }
        const next: Site = {
            domain: current.domain,
            trackerId: current.trackerId,
            timezone: input.timezone
                ? normalizeTimezone(input.timezone)
                : current.timezone,
            customProperties: current.customProperties,
            plausibleScriptId:
                input.plausibleScriptId === undefined
                    ? current.plausibleScriptId
                    : input.plausibleScriptId,
            trackerScriptConfiguration: mergeTrackerConfiguration(
                current.trackerScriptConfiguration,
                input.trackerScriptConfiguration,
            ),
        };
        await this.database.batch([
            this.database
                .prepare(
                    `UPDATE sites SET domain = ?, timezone = ?,
                     tracker_script_configuration = ?, plausible_script_id = ?, updated_at = ?
                     WHERE domain = ?`,
                )
                .bind(
                    next.domain,
                    next.timezone,
                    JSON.stringify(next.trackerScriptConfiguration),
                    next.plausibleScriptId ?? null,
                    new Date().toISOString(),
                    current.domain,
                ),
            this.database
                .prepare("UPDATE goals SET site_id = ? WHERE site_id = ?")
                .bind(next.domain, current.domain),
        ]);
        return next;
    }

    async delete(domain: string): Promise<boolean> {
        const normalized = normalizeDomain(domain);
        const jobId = crypto.randomUUID();
        const requestedAt = new Date().toISOString();
        const expiresAt = new Date(requestedAt);
        expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 3);
        const results = await this.database.batch([
            this.database
                .prepare(
                    `INSERT OR IGNORE INTO site_tombstones (domain, deleted_at)
                     SELECT domain, ? FROM sites WHERE domain = ?`,
                )
                .bind(requestedAt, normalized),
            this.database
                .prepare(
                    `INSERT OR IGNORE INTO site_deletion_jobs
                        (id, site_id, requested_at, analytics_engine_status,
                         analytics_engine_expires_at, iceberg_status, next_attempt_at)
                     SELECT ?, domain, ?, 'pending_expiry', ?, 'pending', ?
                     FROM sites WHERE domain = ?`,
                )
                .bind(
                    jobId,
                    requestedAt,
                    expiresAt.toISOString(),
                    requestedAt,
                    normalized,
                ),
            this.database.prepare("DELETE FROM goals WHERE site_id = ?").bind(normalized),
            this.database
                .prepare("DELETE FROM custom_properties WHERE site_id = ?")
                .bind(normalized),
            this.database.prepare("DELETE FROM sites WHERE domain = ?").bind(normalized),
        ]);
        return Number(results[4].meta.changes || 0) > 0;
    }
}

export function siteResponse(site: Site) {
    return {
        domain: site.domain,
        timezone: site.timezone,
        custom_properties: site.customProperties || [],
        tracker_script_configuration: {
            id: site.trackerId,
            ...site.trackerScriptConfiguration,
        },
        plausible_script_id: site.plausibleScriptId ?? null,
    };
}
