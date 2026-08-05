export type GoalType = "event" | "pageview";
export const MAX_GOALS_PER_SITE = 20;

export interface Goal {
    id: string;
    siteId: string;
    name: string;
    type: GoalType;
    value: string;
    customProps: Record<string, string>;
    createdAt: string;
}

interface GoalRow {
    id: string;
    site_id: string;
    name: string;
    type: GoalType;
    value: string;
    custom_props?: string;
    created_at: string;
}

function toGoal(row: GoalRow): Goal {
    let customProps: Record<string, string> = {};
    try {
        customProps = JSON.parse(row.custom_props || "{}");
    } catch {
        customProps = {};
    }
    return {
        id: row.id,
        siteId: row.site_id,
        name: row.name,
        type: row.type,
        value: row.value,
        customProps,
        createdAt: row.created_at,
    };
}

export class GoalsRepository {
    constructor(private database: D1Database) {}

    async list(siteId: string): Promise<Goal[]> {
        const result = await this.database
            .prepare(
                `SELECT id, site_id, name, type, value, custom_props, created_at
                 FROM goals WHERE site_id = ? ORDER BY created_at ASC LIMIT ${MAX_GOALS_PER_SITE}`,
            )
            .bind(siteId)
            .all<GoalRow>();
        return result.results.map(toGoal);
    }

    async create(input: {
        siteId: string;
        name: string;
        type: GoalType;
        value: string;
        customProps?: Record<string, string>;
    }): Promise<Goal> {
        const name = input.name.trim();
        const value = input.value.trim();
        if (!input.siteId || !name || !value) {
            throw new Error("Site, goal name, and match value are required.");
        }
        if (name.length > 80 || value.length > 256) {
            throw new Error("Goal name or match value is too long.");
        }
        if (input.type !== "event" && input.type !== "pageview") {
            throw new Error("Invalid goal type.");
        }
        const customProps = Object.fromEntries(
            Object.entries(input.customProps || {}).sort(([left], [right]) =>
                left.localeCompare(right),
            ),
        );
        if (
            Object.entries(customProps).some(
                ([key, propertyValue]) =>
                    !key.trim() ||
                    key.length > 80 ||
                    typeof propertyValue !== "string" ||
                    propertyValue.length > 256,
            )
        ) {
            throw new Error("Invalid goal custom properties.");
        }

        const goal: Goal = {
            id: crypto.randomUUID(),
            siteId: input.siteId,
            name,
            type: input.type,
            value,
            customProps,
            createdAt: new Date().toISOString(),
        };
        const result = await this.database
            .prepare(
                `INSERT INTO goals (id, site_id, name, type, value, custom_props, created_at)
                 SELECT ?, ?, ?, ?, ?, ?, ?
                 WHERE (SELECT COUNT(*) FROM goals WHERE site_id = ?) < ?`,
            )
            .bind(
                goal.id,
                goal.siteId,
                goal.name,
                goal.type,
                goal.value,
                JSON.stringify(goal.customProps),
                goal.createdAt,
                goal.siteId,
                MAX_GOALS_PER_SITE,
            )
            .run();
        if (result.meta.changes === 0) {
            throw new Error(
                `A site can have at most ${MAX_GOALS_PER_SITE} goals.`,
            );
        }
        return goal;
    }

    async delete(siteId: string, id: string): Promise<boolean> {
        const result = await this.database
            .prepare("DELETE FROM goals WHERE id = ? AND site_id = ?")
            .bind(id, siteId)
            .run();
        return Number(result.meta.changes || 0) > 0;
    }
}
