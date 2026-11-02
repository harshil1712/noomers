import type { ReactNode } from "react";
import { Breadcrumbs, Text } from "@cloudflare/kumo";

/** Shared page header: breadcrumb trail + title (+ optional description under it) + right-side actions. */
export function PageHeader({
  crumbs,
  title,
  description,
  actions,
}: {
  crumbs?: { label: string; to?: string }[];
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {crumbs && crumbs.length > 0 && (
        <Breadcrumbs size="sm">
          {crumbs.flatMap((c, i) => {
            const el = c.to ? (
              <Breadcrumbs.Link key={c.label} href={c.to}>
                {c.label}
              </Breadcrumbs.Link>
            ) : (
              <Breadcrumbs.Current key={c.label}>{c.label}</Breadcrumbs.Current>
            );
            return i === 0 ? [el] : [<Breadcrumbs.Separator key={`sep-${i}`} />, el];
          })}
        </Breadcrumbs>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <Text variant="heading1" as="h1">
            {title}
          </Text>
          {description && (
            <Text variant="secondary" size="sm">
              {description}
            </Text>
          )}
        </div>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
