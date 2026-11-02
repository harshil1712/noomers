import type { ReactNode } from "react";
import { Breadcrumbs, Text } from "@cloudflare/kumo";

/** Shared page header: breadcrumb trail + title + right-side actions. */
export function PageHeader({
  crumbs,
  title,
  actions,
}: {
  crumbs?: { label: string; to?: string }[];
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {crumbs && crumbs.length > 0 && (
        <Breadcrumbs size="sm">
          {crumbs.map((c) =>
            c.to ? (
              <Breadcrumbs.Link key={c.label} href={c.to}>
                {c.label}
              </Breadcrumbs.Link>
            ) : (
              <Breadcrumbs.Current key={c.label}>{c.label}</Breadcrumbs.Current>
            ),
          )}
        </Breadcrumbs>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Text variant="heading1" as="h1">
          {title}
        </Text>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
