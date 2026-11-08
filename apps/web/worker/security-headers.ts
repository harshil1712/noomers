/** Content-Security-Policy for the SPA. script-src/frame-src allow
 * challenges.cloudflare.com for the Turnstile widget; style-src needs
 * 'unsafe-inline' for React inline styles; no unsafe-eval. */
export const SPA_CSP =
  "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; " +
  "font-src 'self' data:; connect-src 'self' ws: wss: https:; " +
  "frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; " +
  "base-uri 'self'; object-src 'none'; form-action 'self'";
