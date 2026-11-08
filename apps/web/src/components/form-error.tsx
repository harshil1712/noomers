import { useEffect, useRef, type ReactNode } from "react";
import { Banner } from "@cloudflare/kumo";
import { WarningCircle } from "@phosphor-icons/react";

/**
 * Form-level error. Announced (`role="alert"`) and focused when it appears so
 * keyboard and screen-reader users land on it instead of `<body>`.
 *
 * Pass `attempt` (a counter that bumps per failed submit) so a repeated,
 * identical message is re-announced and re-focused.
 */
export function FormError({
  message,
  attempt,
  action,
}: {
  message?: string | null;
  attempt?: number;
  action?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message, attempt]);

  if (!message) return null;
  return (
    <Banner
      ref={ref}
      role="alert"
      tabIndex={-1}
      variant="error"
      size="sm"
      icon={<WarningCircle weight="fill" size={16} aria-hidden />}
      description={message}
      action={action}
      className="outline-none focus-visible:ring-2 focus-visible:ring-kumo-danger"
    />
  );
}
