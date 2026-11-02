import type { ReactNode } from "react";
import { Text } from "@cloudflare/kumo";

/** Page title row: h1, optional description, optional actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <Text variant="heading" size="lg" as="h1">
          {title}
        </Text>
        {description && <Text variant="secondary">{description}</Text>}
      </div>
      {actions && <div className="flex w-full items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}
