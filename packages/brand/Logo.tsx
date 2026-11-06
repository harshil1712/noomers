/** noomers — wordmark only. */
export function Logo({ className }: { size?: number; markOnly?: boolean; className?: string }) {
  return (
    <span
      className={["text-lg font-semibold tracking-tight text-kumo-default", className]
        .filter(Boolean)
        .join(" ")}
    >
      noomers
    </span>
  );
}
