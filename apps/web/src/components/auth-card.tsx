import type { ReactNode } from "react";
import { Link, Surface, Text } from "@cloudflare/kumo";
import { Logo } from "@noomers/brand/Logo.tsx";
import { PRODUCT } from "../config";
import { useDocumentTitle } from "../lib/use-document-title";

/**
 * Layout for every signed-out screen: wordmark back to the marketing site,
 * a `<main>` landmark with one card, the page title as h1 (and `<title>`).
 */
export default function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <div className="flex min-h-svh flex-col bg-kumo-canvas text-kumo-default">
      <header className="flex justify-center px-6 pt-8">
        <Link
          href={`https://${PRODUCT.domain}`}
          variant="plain"
          aria-label={`${PRODUCT.name} website`}
          className="rounded-md p-1 text-kumo-default! focus-visible:ring-2 focus-visible:ring-kumo-brand"
        >
          <Logo size={28} />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:px-6">
        <Surface className="flex w-full max-w-sm flex-col gap-6 rounded-xl p-6 sm:p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <Text variant="heading" size="lg" as="h1">
              {title}
            </Text>
            {description && (
              <Text variant="secondary" size="sm">
                {description}
              </Text>
            )}
          </div>
          {children}
          {footer && <div className="flex flex-col items-center gap-2 text-center">{footer}</div>}
        </Surface>
      </main>
    </div>
  );
}
