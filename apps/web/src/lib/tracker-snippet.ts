export function trackerSnippet(domain: string): string {
  return `<script defer src="${location.origin}/tracker.js" data-site-id="${domain}"></script>`;
}
