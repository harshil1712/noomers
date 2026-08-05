import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { GoalsRepository, type GoalType } from "~/goals/repository";
import { isAuthEnabled, requireAuth } from "~/lib/auth";
import type { SearchFilters } from "~/lib/types";
import { getFiltersFromSearchParams, paramsFromUrl } from "~/lib/utils";

async function getGoalsData(
    context: LoaderFunctionArgs["context"],
    request: Request,
) {
    const url = new URL(request.url);
    const { interval, site } = paramsFromUrl(request.url);
    const timezone = url.searchParams.get("timezone") || "UTC";
    const filters = getFiltersFromSearchParams(url.searchParams);
    const repository = new GoalsRepository(context.cloudflare.env.GOALS_DB);
    const goals = await repository.list(site);
    const counts = await context.analyticsEngine.getCounts(
        site,
        interval,
        timezone,
        filters,
    );
    const conversions = await Promise.all(
        goals.map((goal) =>
            context.analyticsEngine.getGoalConversionCount(
                site,
                goal,
                interval,
                timezone,
                filters,
            ),
        ),
    );

    return {
        canManage: isAuthEnabled(context.cloudflare.env),
        goals: goals.map((goal, index) => ({
            ...goal,
            conversions: conversions[index],
            conversionRate:
                counts.visitors > 0
                    ? Math.min(
                          100,
                          (conversions[index] / counts.visitors) * 100,
                      )
                    : 0,
        })),
    };
}

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);
    return getGoalsData(context, request);
}

export async function action({ context, request }: ActionFunctionArgs) {
    if (!isAuthEnabled(context.cloudflare.env)) {
        throw new Response("Authentication must be enabled to manage goals", {
            status: 403,
        });
    }
    await requireAuth(request, context.cloudflare.env);
    const form = await request.formData();
    const siteId = String(form.get("site") || "");
    const intent = String(form.get("intent") || "");
    const repository = new GoalsRepository(context.cloudflare.env.GOALS_DB);

    if (intent === "create") {
        await repository.create({
            siteId,
            name: String(form.get("name") || ""),
            type: String(form.get("type") || "") as GoalType,
            value: String(form.get("value") || ""),
        });
    } else if (intent === "delete") {
        await repository.delete(siteId, String(form.get("id") || ""));
    } else {
        throw new Response("Invalid goal action", { status: 400 });
    }

    return getGoalsData(context, request);
}

export function GoalsCard({
    siteId,
    interval,
    filters,
    timezone,
}: {
    siteId: string;
    interval: string;
    filters: SearchFilters;
    timezone: string;
}) {
    const fetcher = useFetcher<typeof loader>();
    const params = new URLSearchParams({
        site: siteId,
        interval,
        timezone,
        ...filters,
    });
    const resourceUrl = `/resources/goals?${params}`;

    useEffect(() => {
        void fetcher.load(resourceUrl);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resourceUrl]);

    return (
        <Card className={fetcher.state !== "idle" ? "opacity-60" : ""}>
            <CardHeader>
                <CardTitle>Goals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left border-b">
                                <th className="py-2">Goal</th>
                                <th>Conversions</th>
                                <th>Rate</th>
                                <th aria-label="Actions" />
                            </tr>
                        </thead>
                        <tbody>
                            {(fetcher.data?.goals || []).map((goal) => (
                                <tr
                                    key={goal.id}
                                    className="border-b last:border-0"
                                >
                                    <td className="py-2">
                                        <div className="font-medium">
                                            {goal.name}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {goal.type}: {goal.value}
                                        </div>
                                    </td>
                                    <td>{goal.conversions}</td>
                                    <td>{goal.conversionRate.toFixed(1)}%</td>
                                    <td className="text-right">
                                        {fetcher.data?.canManage && (
                                            <fetcher.Form
                                                method="post"
                                                action={resourceUrl}
                                            >
                                                <input
                                                    type="hidden"
                                                    name="intent"
                                                    value="delete"
                                                />
                                                <input
                                                    type="hidden"
                                                    name="site"
                                                    value={siteId}
                                                />
                                                <input
                                                    type="hidden"
                                                    name="id"
                                                    value={goal.id}
                                                />
                                                <button
                                                    className="text-xs underline"
                                                    type="submit"
                                                >
                                                    Delete
                                                </button>
                                            </fetcher.Form>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {fetcher.data?.canManage ? (
                    <fetcher.Form
                        method="post"
                        action={resourceUrl}
                        className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_auto]"
                    >
                        <input type="hidden" name="intent" value="create" />
                        <input type="hidden" name="site" value={siteId} />
                        <input
                            className="rounded-md border bg-background px-3 py-2 text-sm"
                            name="name"
                            placeholder="Goal name"
                            maxLength={80}
                            required
                        />
                        <select
                            className="rounded-md border bg-background px-3 py-2 text-sm"
                            name="type"
                        >
                            <option value="event">Event</option>
                            <option value="pageview">Pageview</option>
                        </select>
                        <input
                            className="rounded-md border bg-background px-3 py-2 text-sm"
                            name="value"
                            placeholder="Signup or /thank-you"
                            maxLength={256}
                            required
                        />
                        <button
                            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                            type="submit"
                        >
                            Add goal
                        </button>
                    </fetcher.Form>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        Enable dashboard authentication to manage goals.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
