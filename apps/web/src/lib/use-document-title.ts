import { useEffect } from "react";
import { PRODUCT } from "../config";

/** Per-route `<title>`: "Settings · noomers". */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${PRODUCT.name}` : PRODUCT.name;
  }, [title]);
}
