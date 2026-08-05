export class CustomPropertiesRepository {
    constructor(private database: D1Database) {}

    async list(siteId: string): Promise<string[]> {
        const result = await this.database
            .prepare(
                "SELECT property FROM custom_properties WHERE site_id = ? ORDER BY property ASC",
            )
            .bind(siteId)
            .all<{ property: string }>();
        return result.results.map(({ property }) => property);
    }

    async create(siteId: string, value: string): Promise<boolean> {
        const property = normalizeProperty(value);
        await this.database
            .prepare(
                "INSERT OR IGNORE INTO custom_properties (site_id, property) VALUES (?, ?)",
            )
            .bind(siteId, property)
            .run();
        return true;
    }

    async delete(siteId: string, value: string): Promise<boolean> {
        const property = normalizeProperty(value);
        const result = await this.database
            .prepare("DELETE FROM custom_properties WHERE site_id = ? AND property = ?")
            .bind(siteId, property)
            .run();
        return Number(result.meta.changes || 0) > 0;
    }
}

function normalizeProperty(value: string): string {
    const property = value.trim();
    if (!property || property.length > 80) {
        throw new Error("property must be between 1 and 80 characters.");
    }
    return property;
}
