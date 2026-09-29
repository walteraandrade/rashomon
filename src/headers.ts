// The security headers as data, so `src/server.ts` and `vercel.json` can carry the same set:
// Vercel's CDN serves public/ without calling the function, so the JSON copy cannot go, and
// `pnpm dev` or any other host has only this one. test/security-headers-acceptance.test.ts holds
// the two copies together byte for byte.

// A <meta> cannot carry frame-ancestors; the prerendered meta carries the script hashes.
export const CSP = "frame-ancestors 'none'"

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

// Only the HTML entry points: never /api/* and never a static asset.
export const HTML_PATHS = ['/', '/como-ler', '/sobre'] as const

/** The exact `headers` array `vercel.json` must hold. */
export const vercelHeaders = () =>
  HTML_PATHS.map((source) => ({
    source,
    headers: Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value })),
  }))
