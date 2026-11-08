import { useId, type ReactNode } from "react";
import { Surface, Text } from "@cloudflare/kumo";

/** One settings card: h2 + description, body, optional footer row for actions. */
export function SettingsSection({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const headingId = useId();
  return (
    <Surface
      as="section"
      aria-labelledby={headingId}
      className="flex flex-col overflow-hidden rounded-xl"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <Text variant="heading" as="h2" id={headingId}>
            {title}
          </Text>
          {description && (
            <Text variant="secondary" size="sm">
              {description}
            </Text>
          )}
        </div>
        {children}
      </div>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-kumo-line px-5 py-3">
          {footer}
        </div>
      )}
    </Surface>
  );
}
