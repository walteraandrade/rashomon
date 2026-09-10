import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { HTML_PATHS, SECURITY_HEADERS, vercelHeaders } from '../src/headers.js'
import { app } from '../src/server.js'
import { VERCEL_INSIGHTS } from './pages.js'
import { docsText } from './docs.js'
import { seed } from './fixture.js'
import './close.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vercelConfig = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))

type HeaderEntry = { key: string; value: string }
type HeadersRule = { source: string; headers: HeaderEntry[] }

const REQUIRED_PATHS = ['/', '/design-5.html', '/como-ler.html']

/**
 * Vercel's `headers.source` may be an exact path or a regex-flavoured pattern. Either way it
 * must resolve to the request path, not to the JSON shape used to express it (spec section 2).
 */
const sourceMatches = (source: string, path: string): boolean => {
  if (source === path) return true
  try {
    return new RegExp(`^${source}$`).test(path)
  } catch {
    return false
  }
}

/** Every header entry whose `source` resolves to `path`, merged key-first-wins. */
const resolveHeaders = (rules: HeadersRule[], path: string): Record<string, string> => {
  const merged: Record<string, string> = {}
  for (const rule of rules) {
    if (!sourceMatches(rule.source, path)) continue
    for (const { key, value } of rule.headers) {
      if (!(key in merged)) merged[key] = value
    }
  }
  return merged
}

/** CSP directive name to its space-separated token list. */
const parseCsp = (csp: string): Map<string, string[]> => {
  const directives = new Map<string, string[]>()
  for (const chunk of csp.split(';')) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    const [name, ...tokens] = trimmed.split(/\s+/)
    directives.set(name, tokens)
  }
  return directives
}

describe('security headers (vercel.json)', () => {
  it('AC1: vercel.json has no top-level routes key', () => {
    assert.equal('routes' in vercelConfig, false)
  })

  it('AC2: rewrites replaces routes with the same two src/dest pairs, renamed, and no explicit filesystem handle', () => {
    assert.ok(Array.isArray(vercelConfig.rewrites), 'rewrites must be a top-level array')
    assert.equal(vercelConfig.rewrites.length, 2)

    const pairs = vercelConfig.rewrites.map((r: any) => [r.source, r.destination])
    assert.deepEqual(
      new Set(pairs.map((p: string[]) => p.join(' -> '))),
      new Set(['/api/(.*) -> /api/index', '/ -> /design-5.html']),
    )

    // no explicit `{ handle: "filesystem" }` entry anywhere in the config; Vercel's implicit
    // fallback under `rewrites` is what serves public/ statics. (Actually enforcing that the
    // fallback still serves statics is a manual preview-deploy check, per the spec.)
    const json = JSON.stringify(vercelConfig)
    assert.doesNotMatch(json, /"handle"\s*:\s*"filesystem"/)
  })

  // Under `rewrites` Vercel serves a file from public/ before it consults the list, so a file
  // named like a literal `source` swallows the rewrite in silence: public/index.html did exactly
  // that to `/` until #123 deleted it. The other direction matters too: a static `destination`
  // that no file backs is a rewrite to a 404.
  it('no file under public/ shadows a literal rewrite source, and every static destination is backed by one', () => {
    const rewrites: { source: string; destination: string }[] = vercelConfig.rewrites
    const isLiteral = (path: string) => !/[()*+?[\]{}|\\]/.test(path)
    const shadowsOf = (path: string) => (path.endsWith('/') ? [`${path}index.html`] : [path, `${path}.html`, `${path}/index.html`])

    for (const { source, destination } of rewrites) {
      if (isLiteral(source)) {
        for (const shadow of shadowsOf(source)) {
          assert.ok(!existsSync(join(root, 'public', shadow)), `public${shadow} would be served in place of the rewrite ${source} -> ${destination}`)
        }
      }
      if (!destination.startsWith('/api/')) {
        assert.ok(existsSync(join(root, 'public', destination)), `rewrite ${source} -> ${destination} points at no file under public/`)
      }
    }
  })

  it('AC3: $schema, framework, buildCommand and outputDirectory are unchanged', () => {
    assert.equal(vercelConfig.$schema, 'https://openapi.vercel.sh/vercel.json')
    assert.equal(vercelConfig.framework, null)
    assert.equal(vercelConfig.buildCommand, null)
    assert.equal(vercelConfig.outputDirectory, null)
  })

  it('AC4: headers[] resolves to exactly the three HTML entry points', () => {
    assert.ok(Array.isArray(vercelConfig.headers), 'headers must be a top-level array')
    const rules: HeadersRule[] = vercelConfig.headers
    for (const path of REQUIRED_PATHS) {
      const matched = rules.filter((r) => sourceMatches(r.source, path))
      assert.ok(matched.length > 0, `no headers entry resolves to ${path}`)
    }

    // the CSP is scoped to exactly the three HTML sources, never the whole site (spec section 3)
    for (const path of ['/api/people', '/api/people/1/graph', '/atlas.css', '/bundle.js']) {
      const matched = rules.filter((r) => sourceMatches(r.source, path))
      assert.equal(matched.length, 0, `${path} must not pick up the CSP`)
    }
  })

  it('AC5-AC7: CSP, nosniff, referrer-policy and permissions-policy apply to every HTML entry point', () => {
    const rules: HeadersRule[] = vercelConfig.headers
    for (const path of REQUIRED_PATHS) {
      const headers = resolveHeaders(rules, path)

      const csp = headers['Content-Security-Policy']
      assert.ok(csp, `${path}: missing Content-Security-Policy`)
      const directives = parseCsp(csp)
      assert.deepEqual(directives.get('script-src'), ["'self'"], `${path}: script-src must be exactly 'self'`)

      const styleSrc = directives.get('style-src') ?? []
      assert.ok(styleSrc.includes("'self'"), `${path}: style-src must include 'self'`)
      assert.ok(styleSrc.includes("'unsafe-inline'"), `${path}: style-src must include 'unsafe-inline'`)

      assert.equal(headers['X-Content-Type-Options'], 'nosniff', `${path}: X-Content-Type-Options must be nosniff`)
      assert.equal(
        headers['Referrer-Policy'],
        'strict-origin-when-cross-origin',
        `${path}: Referrer-Policy must be strict-origin-when-cross-origin`,
      )

      const permissions = headers['Permissions-Policy']
      assert.ok(permissions, `${path}: missing Permissions-Policy`)
      const tokens = permissions.split(',').map((t) => t.trim())
      for (const denied of ['camera=()', 'microphone=()', 'geolocation=()']) {
        assert.ok(tokens.includes(denied), `${path}: Permissions-Policy must deny ${denied}`)
      }
    }
  })

  it('AC5-AC6: script-src and style-src token sets, isolated from directive order', () => {
    const rules: HeadersRule[] = vercelConfig.headers
    for (const path of REQUIRED_PATHS) {
      const headers = resolveHeaders(rules, path)
      const directives = parseCsp(headers['Content-Security-Policy'])

      const scriptSrc = new Set(directives.get('script-src'))
      assert.equal(scriptSrc.size, 1)
      assert.ok(scriptSrc.has("'self'"))
      assert.ok(!scriptSrc.has("'unsafe-inline'"))
      assert.ok(!scriptSrc.has("'unsafe-eval'"))

      const styleSrc = new Set(directives.get('style-src'))
      assert.ok(styleSrc.has("'self'"))
      assert.ok(styleSrc.has("'unsafe-inline'"))
    }
  })

  it('AC8: the analytics tag Vercel serves is same-origin and therefore CSP-covered', () => {
    assert.match(VERCEL_INSIGHTS, /^\//)
    assert.doesNotMatch(VERCEL_INSIGHTS, /^https?:/)
  })

  it('AC10: the docs state the CSP forbids inline/eval scripts and allows inline styles for the per-value overrides', () => {
    // the two facts: no inline/eval scripts, and inline styles are allowed for --size/--tone
    assert.match(
      docsText,
      /script-src[\s\S]{0,200}'self'|no inline[\s\S]{0,80}script|forbids inline[\s\S]{0,80}script/i,
    )
    assert.match(
      docsText,
      /inline styles?[\s\S]{0,80}(--size|--tone)|(--size|--tone)[\s\S]{0,80}inline styles?/i,
    )
  })
})

// Issue #129: the headers live twice, once in vercel.json for the CDN and once in
// src/headers.ts for this process. One test holds the copies together and reads a real
// response, not the JSON shape, for what Hono sends.

describe('security headers drift', () => {
  before(seed)

  it('vercel.json headers equal src/headers.ts byte for byte', () => {
    assert.deepEqual(vercelConfig.headers, vercelHeaders())
  })

  for (const path of HTML_PATHS)
    it(`Hono sends every header on ${path}`, async () => {
      const res = await app.request(path)
      assert.equal(res.status, 200)
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(key), value, key)
    })

  for (const path of ['/api/people', '/api/nope', '/atlas.css', '/bundle.js'])
    it(`Hono sends none of them on ${path}`, async () => {
      const res = await app.request(path)
      for (const key of Object.keys(SECURITY_HEADERS)) assert.equal(res.headers.get(key), null, `${path} carries ${key}`)
    })

  it('the docs say both copies exist and which test binds them', () => {
    assert.match(docsText, /src\/headers\.ts/)
    assert.match(docsText, /security-headers-acceptance\.test\.ts/)
  })
})
