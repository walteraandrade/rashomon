// The security headers as data, so `src/server.ts` and `vercel.json` can carry the same set:
// Vercel's CDN serves public/ without calling the function, so the JSON copy cannot go, and
// `pnpm dev` or any other host has only this one. test/security-headers-acceptance.test.ts holds
// the two copies together byte for byte.

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ')

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

// Only the HTML entry points: never /api/* and never a static asset.
export const HTML_PATHS = ['/', '/design-5.html', '/como-ler.html'] as const

/** The exact `headers` array `vercel.json` must hold. */
export const vercelHeaders = () =>
  HTML_PATHS.map((source) => ({
    source,
    headers: Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value })),
  }))
