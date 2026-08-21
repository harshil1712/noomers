import { describe, it, expect } from "vitest";
import {
    BACKFILL_LIMIT,
    BACKFILL_BATCH_SIZE,
    buildHistoricalSiteIdsQuery,
    parseHistoricalSiteIds,
    hasAnalyticsEngineErrors,
    normalizeHistoricalSiteId,
    buildBackfillInsertStatement,
    buildBackfillInsertBatches,
    validateDatasetIdentifier,
    escapeSqlString,
} from "../backfill.js";

describe("validateDatasetIdentifier", () => {
    it("accepts a normal dataset identifier", () => {
        expect(validateDatasetIdentifier("metricsDataset")).toBe(
            "metricsDataset",
        );
        expect(validateDatasetIdentifier("  my-dataset_1  ")).toBe(
            "my-dataset_1",
        );
    });

    it("rejects empty dataset identifiers", () => {
        expect(() => validateDatasetIdentifier("")).toThrow(
            "Analytics dataset is required",
        );
        expect(() => validateDatasetIdentifier("   ")).toThrow();
    });

    it("rejects unsafe identifiers and backticks", () => {
        expect(() =>
            validateDatasetIdentifier("metrics; DROP TABLE x"),
        ).toThrow();
        expect(() => validateDatasetIdentifier("metrics' OR '1'='1")).toThrow();
        expect(() => validateDatasetIdentifier("a b")).toThrow();
        expect(() => validateDatasetIdentifier("`metrics`")).toThrow();
        expect(() => validateDatasetIdentifier("a`b")).toThrow();
    });
});

describe("buildHistoricalSiteIdsQuery", () => {
    it("builds a bounded query against blob8 with a sentinel and double-quoted dataset", () => {
        const sql = buildHistoricalSiteIdsQuery("metrics-dataset");
        expect(sql).toContain("SELECT blob8 AS siteId");
        expect(sql).toContain('FROM "metrics-dataset"');
        expect(sql).toContain("GROUP BY blob8");
        expect(sql).toContain(`LIMIT ${BACKFILL_LIMIT + 1}`);
    });

    it("validates the dataset identifier before interpolation", () => {
        expect(() => buildHistoricalSiteIdsQuery("bad; DROP")).toThrow();
        expect(() => buildHistoricalSiteIdsQuery("bad`name")).toThrow();
        expect(() => buildHistoricalSiteIdsQuery('bad"name')).toThrow();
    });
});

describe("hasAnalyticsEngineErrors", () => {
    it("returns true for a nonempty errors array", () => {
        expect(hasAnalyticsEngineErrors({ errors: [{ code: 1 }] })).toBe(true);
    });

    it("returns false for an empty errors array", () => {
        expect(hasAnalyticsEngineErrors({ errors: [] })).toBe(false);
    });

    it("returns true for a nonempty errors object and false for empty", () => {
        expect(hasAnalyticsEngineErrors({ errors: { message: "x" } })).toBe(
            true,
        );
        expect(hasAnalyticsEngineErrors({ errors: {} })).toBe(false);
    });

    it("returns false when errors is null/undefined", () => {
        expect(hasAnalyticsEngineErrors({ errors: null })).toBe(false);
        expect(hasAnalyticsEngineErrors({ errors: undefined })).toBe(false);
        expect(hasAnalyticsEngineErrors({})).toBe(false);
    });
});

describe("parseHistoricalSiteIds (real Analytics Engine shape)", () => {
    it("parses the data array of objects with a siteId alias", () => {
        const response = {
            data: [{ siteId: "example.com" }, { siteId: "foo.com" }],
            rows: 2,
            meta: "2 rows",
        };
        expect(parseHistoricalSiteIds(response)).toEqual([
            "example.com",
            "foo.com",
        ]);
    });

    it("fails closed when a 200 response body contains a nonempty errors field", () => {
        const response = {
            data: [{ siteId: "example.com" }],
            errors: [{ code: 40004, message: "Invalid query" }],
        };
        expect(() => parseHistoricalSiteIds(response)).toThrow(
            /errors in the response body/,
        );
    });

    it("rejects an unrecognized response shape (no data array)", () => {
        expect(() => parseHistoricalSiteIds({ rows: 2 })).toThrow(
            "unrecognized query response shape",
        );
    });

    it("fails clearly when the result exceeds the bound", () => {
        const data = Array.from({ length: BACKFILL_LIMIT + 1 }, () => ({
            siteId: "x.com",
        }));
        expect(() => parseHistoricalSiteIds({ data })).toThrow(
            /More than 1000 distinct historical site IDs/,
        );
    });

    it("accepts results at exactly the bound", () => {
        const data = Array.from({ length: BACKFILL_LIMIT }, (_, i) => ({
            siteId: `site${i}.com`,
        }));
        expect(parseHistoricalSiteIds({ data })).toHaveLength(BACKFILL_LIMIT);
    });
});

describe("normalizeHistoricalSiteId", () => {
    it("normalizes and validates a domain", () => {
        expect(normalizeHistoricalSiteId("EXAMPLE.com")).toBe("example.com");
    });

    it("ignores null, undefined, and empty values", () => {
        expect(normalizeHistoricalSiteId(null)).toBeNull();
        expect(normalizeHistoricalSiteId(undefined)).toBeNull();
        expect(normalizeHistoricalSiteId("")).toBeNull();
        expect(normalizeHistoricalSiteId("   ")).toBeNull();
    });

    it("throws on malformed nonempty site IDs instead of silently dropping them", () => {
        expect(() => normalizeHistoricalSiteId(123)).toThrow(
            /refusing to silently drop/,
        );
        expect(() => normalizeHistoricalSiteId("bad domain")).toThrow(
            /Invalid historical site ID/,
        );
        expect(() => normalizeHistoricalSiteId("a/b")).toThrow();
    });
});

describe("buildBackfillInsertStatement", () => {
    it("uses valid SQLite derived-table syntax with column aliases in the first SELECT", () => {
        const sql = buildBackfillInsertStatement(["example.com"], "Etc/UTC");
        expect(sql).toContain("INSERT INTO sites");
        expect(sql).toContain("'example.com' AS domain");
        expect(sql).toContain("AS tracker_id");
        expect(sql).toContain("AS timezone");
        expect(sql).toContain("AS tracker_script_configuration");
        expect(sql).toContain(") AS candidate");
        // No derived column list after the alias.
        expect(sql).not.toMatch(/AS candidate\s*\(/);
        expect(sql).toContain("NOT EXISTS (SELECT 1 FROM sites s");
        expect(sql).toContain("NOT EXISTS (SELECT 1 FROM site_tombstones t");
    });

    it("supports multiple domains via UNION ALL", () => {
        const sql = buildBackfillInsertStatement(
            ["a.com", "b.com"],
            "America/New_York",
        );
        expect(sql).toContain("UNION ALL");
        expect(sql).toContain("a.com");
        expect(sql).toContain("b.com");
    });

    describe("exact SQL structure preserves fail-closed and rerun-safe semantics", () => {
        it("wraps every candidate in a derived table with no trailing derived column list", () => {
            const sql = buildBackfillInsertStatement(
                ["a.com", "b.com"],
                "America/New_York",
            );
            // Each candidate aliases its columns in the first SELECT.
            expect(sql).toContain("'a.com' AS domain");
            expect(sql).toContain("'b.com' AS domain");
            expect(sql).toContain("America/New_York");
            // Derived table is aliased as candidate without a (column list) suffix.
            expect(sql).toContain(") AS candidate WHERE");
            expect(sql).not.toContain("AS candidate (");
        });

        it("skips already-registered sites and permanent tombstones in the WHERE", () => {
            const sql = buildBackfillInsertStatement(
                ["existing.com", "gone.com"],
                "Etc/UTC",
            );
            expect(sql).toContain(
                "WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.domain = candidate.domain)",
            );
            expect(sql).toContain(
                "AND NOT EXISTS (SELECT 1 FROM site_tombstones t WHERE t.domain = candidate.domain)",
            );
        });

        it("is rerun-safe: the INSERT targets only domains absent from sites and tombstones", () => {
            const sql = buildBackfillInsertStatement(["a.com"], "Etc/UTC");
            // INSERT ... SELECT ... WHERE NOT EXISTS is idempotent: re-running
            // finds the row already present and inserts nothing.
            expect(sql).toContain(
                "INSERT INTO sites (domain, tracker_id, timezone, tracker_script_configuration)",
            );
            expect(sql).toContain(
                "WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.domain = candidate.domain)",
            );
            expect(sql).toContain(
                "AND NOT EXISTS (SELECT 1 FROM site_tombstones t WHERE t.domain = candidate.domain)",
            );
        });
    });
});

describe("escapeSqlString", () => {
    it("escapes single quotes defensively", () => {
        expect(escapeSqlString("a'b")).toBe("a''b");
        expect(escapeSqlString("plain")).toBe("plain");
    });
});

describe("buildBackfillInsertBatches", () => {
    it("produces a single batch for fewer than the batch size", () => {
        const batches = buildBackfillInsertBatches(
            ["a.com", "b.com"],
            "Etc/UTC",
        );
        expect(batches).toHaveLength(1);
        expect(batches[0]).toContain("a.com");
        expect(batches[0]).toContain("b.com");
    });

    it("splits domains into bounded batches at exactly the batch size", () => {
        const domains = Array.from(
            { length: BACKFILL_BATCH_SIZE + 1 },
            (_, i) => `site${i}.com`,
        );
        const batches = buildBackfillInsertBatches(domains, "Etc/UTC");
        expect(batches).toHaveLength(2);
        expect(batches[0]).toContain("site0.com");
        expect(batches[1]).toContain(`site${BACKFILL_BATCH_SIZE}.com`);
        // Each batch statement is bounded and deterministic in order.
        expect(batches[0].split("UNION ALL")).toHaveLength(BACKFILL_BATCH_SIZE);
    });

    it("preserves deterministic order and per-batch idempotency/tombstone checks", () => {
        const domains = Array.from(
            { length: BACKFILL_BATCH_SIZE * 2 },
            (_, i) => `site${i}.com`,
        );
        const batches = buildBackfillInsertBatches(domains, "America/New_York");
        expect(batches).toHaveLength(2);
        for (const sql of batches) {
            expect(sql).toContain(
                "WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.domain = candidate.domain)",
            );
            expect(sql).toContain(
                "AND NOT EXISTS (SELECT 1 FROM site_tombstones t WHERE t.domain = candidate.domain)",
            );
        }
        // Batch 0 covers site0..site{BS-1}; batch 1 starts at site{BS}.
        expect(batches[0]).toContain("site0.com");
        expect(batches[0]).toContain(`site${BACKFILL_BATCH_SIZE - 1}.com`);
        expect(batches[1]).toContain(`site${BACKFILL_BATCH_SIZE}.com`);
        expect(batches[1]).toContain(`site${BACKFILL_BATCH_SIZE * 2 - 1}.com`);
    });

    it("handles a boundary of exactly the batch size as one batch", () => {
        const domains = Array.from(
            { length: BACKFILL_BATCH_SIZE },
            (_, i) => `site${i}.com`,
        );
        const batches = buildBackfillInsertBatches(domains, "Etc/UTC");
        expect(batches).toHaveLength(1);
    });

    it("rejects a non-positive batch size", () => {
        expect(() =>
            buildBackfillInsertBatches(["a.com"], "Etc/UTC", 0),
        ).toThrow("batchSize must be a positive integer");
    });

    it("returns no batches for an empty domain list", () => {
        expect(buildBackfillInsertBatches([], "Etc/UTC")).toEqual([]);
    });
});
