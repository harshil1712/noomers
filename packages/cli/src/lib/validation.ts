/**
 * Validation helpers shared by the installer and provisioning flow.
 * These mirror the server's SitesRepository validation so the CLI never
 * proposes a site the server would reject.
 */

const MAX_DOMAIN_LENGTH = 253;
const INVALID_DOMAIN_CHARS = /[\s/:]/;

/**
 * Normalize a domain the same way the server does: trim, lowercase, and
 * reject domains containing whitespace, slashes, or colons or that exceed
 * 253 characters. Returns the normalized domain.
 */
export function normalizeDomain(value: string): string {
    const domain = value.trim().toLowerCase();
    if (
        !domain ||
        domain.length > MAX_DOMAIN_LENGTH ||
        INVALID_DOMAIN_CHARS.test(domain)
    ) {
        throw new Error(
            "A valid domain is required (lowercase, no spaces, slashes, or colons, at most 253 characters).",
        );
    }
    return domain;
}

/**
 * Normalize an IANA reporting timezone. Falls back to UTC when omitted and
 * throws when the value is not a valid IANA timezone identifier.
 */
export function normalizeTimezone(value?: string): string {
    const timezone = value?.trim() || "Etc/UTC";
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    } catch {
        throw new Error(
            "A valid IANA timezone is required (for example America/New_York or Etc/UTC).",
        );
    }
    return timezone;
}

/**
 * Character set allowed in an Analytics Engine dataset identifier. Quoting
 * characters are intentionally excluded because the identifier is quoted with
 * double quotes when building SQL.
 */
const DATASET_IDENTIFIER_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Validate a dataset identifier before interpolating it into Analytics Engine
 * SQL or a Wrangler configuration. The validated value is then quoted with
 * double quotes, so only a restricted character set is
 * permitted.
 */
export function validateDatasetIdentifier(dataset: string): string {
    const value = dataset.trim();
    if (!value) {
        throw new Error("Analytics dataset is required.");
    }
    if (!DATASET_IDENTIFIER_RE.test(value)) {
        throw new Error(
            "Analytics dataset may contain only letters, digits, underscores, and dashes.",
        );
    }
    return value;
}

export function isValidDomain(value: string): boolean {
    try {
        normalizeDomain(value);
        return true;
    } catch {
        return false;
    }
}

export function isValidTimezone(value: string): boolean {
    try {
        normalizeTimezone(value);
        return true;
    } catch {
        return false;
    }
}
