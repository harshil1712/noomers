import { AnalyticsEngineAPI } from "../../app/analytics/query";
import { ColumnMappings } from "../../app/analytics/schema";
import { tableFromJSON, tableToIPC } from "apache-arrow";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

export async function extractAsArrow(
    { accountId, bearerToken }: { accountId: string; bearerToken: string },
    bucket: R2Bucket,
) {
    const api = new AnalyticsEngineAPI(accountId, bearerToken);

    // Extract the exact UTC half-open previous-day interval
    // [UTC yesterday 00:00:00, UTC today 00:00:00)
    const todayUtc = dayjs().utc().startOf("day");
    const yesterdayUtc = todayUtc.subtract(1, "day");
    const startDateTime = yesterdayUtc.toDate();
    const endDateTime = todayUtc.toDate();

    // Get all columns we want to extract
    const columns = Object.keys(ColumnMappings).filter(
        (key) =>
            key !== "siteId" &&
            key !== "newVisitor" &&
            key !== "bounce" &&
            key !== "visitorId" &&
            key !== "eventProperties",
    ) as (keyof typeof ColumnMappings)[];

    // Fetch data for yesterday
    const data = await api.getAllCountsByAllColumnsForAllSites(
        columns,
        startDateTime,
        endDateTime,
    );

    // Convert Map to array of records for Arrow table creation
    const records: any[] = [];
    data.forEach((counts, key) => {
        const [date, siteId, ...columnValues] = key;
        const record: any = {
            date,
            siteId,
            views: counts.views,
            visitors: counts.visitors,
            bounces: counts.bounces,
            events: counts.events || 0,
        };

        // Add column values
        columns.forEach((column, index) => {
            record[column] = columnValues[index];
        });

        records.push(record);
    });

    const recordsBySite = Map.groupBy(records, (record) => String(record.siteId));
    const filenames = await Promise.all(
        Array.from(recordsBySite, async ([siteId, siteRecords]) => {
            const table = tableFromJSON(siteRecords);
            const arrowBuffer = new Uint8Array(tableToIPC(table, "file"));
            const filename = `sites/${encodeURIComponent(siteId)}/analytics-${yesterdayUtc.format("YYYY-MM-DD")}.arrow`;
            await bucket.put(filename, arrowBuffer);
            return filename;
        }),
    );

    console.log(`Saved ${records.length} records to ${filenames.length} files`);

    return { filenames, recordCount: records.length };
}

// IIFE for testing
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        // Mock R2 bucket for local testing
        const mockBucket = {
            put: async (filename: string, data: Uint8Array) => {
                console.log(
                    `Mock: Would save ${data.length} bytes to ${filename}`,
                );
                return {
                    key: filename,
                    version: "mock",
                    size: data.length,
                    etag: "mock",
                    httpEtag: "mock",
                    uploaded: new Date(),
                    checksums: { md5: "mock", sha1: "mock", sha256: "mock" },
                    storageClass: "STANDARD",
                    writeHttpMetadata: {},
                };
            },
            head: async () => null,
            get: async () => null,
            delete: async () => {},
            createMultipartUpload: async () => ({
                uploadId: "mock",
                key: "mock",
                uploadPart: async () => ({ partNumber: 1, etag: "mock" }),
                abort: async () => {},
                complete: async () => ({
                    key: "mock",
                    version: "mock",
                    size: 0,
                    etag: "mock",
                    httpEtag: "mock",
                    uploaded: new Date(),
                    checksums: { md5: "mock", sha1: "mock", sha256: "mock" },
                    storageClass: "STANDARD",
                    writeHttpMetadata: {},
                }),
            }),
            resumeMultipartUpload: async () => ({
                uploadId: "mock",
                key: "mock",
                uploadPart: async () => ({ partNumber: 1, etag: "mock" }),
                abort: async () => {},
                complete: async () => ({
                    key: "mock",
                    version: "mock",
                    size: 0,
                    etag: "mock",
                    httpEtag: "mock",
                    uploaded: new Date(),
                    checksums: { md5: "mock", sha1: "mock", sha256: "mock" },
                    storageClass: "STANDARD",
                    writeHttpMetadata: {},
                }),
            }),
            list: async () => ({
                objects: [],
                delimitedPrefixes: [],
                truncated: false,
            }),
        } as unknown as R2Bucket;

        // Get credentials from environment variables
        const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        const bearerToken = process.env.CLOUDFLARE_API_TOKEN;

        if (!accountId || !bearerToken) {
            console.error(
                "Error: Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables",
            );
            process.exit(1);
        }

        try {
            const result = await extractAsArrow(
                { accountId, bearerToken },
                mockBucket,
            );
            console.log("Success:", result);
        } catch (error) {
            console.error("Error:", error);
            process.exit(1);
        }
    })();
}
