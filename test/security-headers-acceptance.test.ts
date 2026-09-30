import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { HTML_PATHS, SECURITY_HEADERS, vercelHeaders } from '../src/headers.js'
import { app } from '../src/server.js'
import { ROUTES, VERCEL_INSIGHTS } from './pages.js'
import { docsText } from './docs.js'
import { seed } from './fixture.js'
import './close.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vercelConfig = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))

type HeaderEntry = { key: string; value: string }
type HeadersRule = { source: string; headers: HeaderEntry[] }


type Redirect = { source: string; destination: string; permanent: boolean }
type Rewrite = { source: string; destination: string }

/** A vercel.json source is a path or a path-to-regexp pattern; only a literal or a regex form is tried. */
const sourceMatches = (source: string, path: string): boolean => {
  if (source === path) return true
  try {
    return new RegExp(`^${source}$`).test(path)
  } catch {
    return false
  }
}

const parseCsp = (csp: string): Map<string, string[]> => {
  const directives = new Map<string, string[]>()
  for (const chunk of csp.split(';')) {
    const [name, ...tokens] = chunk.trim().split(/\s+/)
    if (name) directives.set(name, tokens)
  }
  return directives
}

describe('security headers (vercel.json)', () => {
  it('header CSP carries only frame-ancestors', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy']
    assert.match(csp, /frame-ancestors 'none'/)
    assert.doesNotMatch(csp, /script-src/)
    assert.doesNotMatch(csp, /default-src/)
    assert.deepEqual([...parseCsp(csp).keys()], ['frame-ancestors'])
    assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff')
    assert.equal(SECURITY_HEADERS['Referrer-Policy'], 'strict-origin-when-cross-origin')
    assert.match(SECURITY_HEADERS['Permissions-Policy'], /camera=\(\)/)
  })

  it('vercel.json headers equal vercelHeaders', () => {
    assert.deepEqual(vercelConfig.headers, vercelHeaders())
  })

  it('every HTML path has exactly one headers block, and only the three pages', () => {
    assert.deepEqual([...HTML_PATHS].sort(), ['/', '/como-ler', '/sobre'])
    for (const path of HTML_PATHS) {
      const blocks = (vercelConfig.headers as HeadersRule[]).filter((r) => sourceMatches(r.source, path))
      assert.equal(blocks.length, 1, `${path} must resolve to exactly one headers block`)
    }
    for (const path of ['/api/people', '/atlas.css', '/atlas.html'])
      assert.equal((vercelConfig.headers as HeadersRule[]).filter((r) => sourceMatches(r.source, path)).length, 0, `${path} must not carry the page headers`)
  })

  it('vercel.json build, rewrites and redirects', () => {
    assert.equal(vercelConfig.framework, null)
    assert.equal(vercelConfig.buildCommand, 'pnpm build')
    assert.equal(vercelConfig.outputDirectory, 'build')
    assert.equal('routes' in vercelConfig, false)

    const rewrites: Rewrite[] = vercelConfig.rewrites
    assert.deepEqual(
      rewrites.map((r) => `${r.source} -> ${r.destination}`).sort(),
      ['/api/(.*) -> /api/index', '/como-ler -> /como-ler.html', '/sobre -> /sobre.html'],
    )

    const redirects: Redirect[] = vercelConfig.redirects
    assert.deepEqual(
      redirects.map((r) => `${r.source} -> ${r.destination} ${r.permanent}`).sort(),
      ['/atlas.html -> / true', '/como-ler.html -> /como-ler true', '/design-5.html -> / true', '/sobre.html -> /sobre true'],
    )

    for (const { source } of [...rewrites, ...redirects]) assert.equal(sourceMatches(source, '/'), false, `${source} must not match /`)
  })

  it('every route has a page', () => {
    const rewrites: Rewrite[] = vercelConfig.rewrites
    const routeDir = (path: string) => join(root, 'web', 'routes', path === '/' ? '' : path)
    const hasPage = (path: string) => existsSync(join(routeDir(path), '+page.svelte'))
    for (const { source, destination } of rewrites) {
      if (destination.startsWith('/api/')) continue
      const route = destination.replace(/\.html$/, '')
      assert.ok(hasPage(route), `rewrite ${source} -> ${destination} has no web/routes page for ${route}`)
    }
    for (const path of HTML_PATHS) assert.ok(hasPage(path), `${path} has no +page.svelte under web/routes/`)
    assert.deepEqual(ROUTES.map((r) => r.path).sort(), [...HTML_PATHS].sort())
  })

  it('no static file under public/ shadows a rewrite source or the root page', () => {
    for (const { source } of vercelConfig.rewrites as Rewrite[])
      for (const shadow of [source, `${source}.html`]) assert.ok(!existsSync(join(root, 'public', shadow)), `public${shadow} would shadow ${source}`)
    assert.ok(!existsSync(join(root, 'public', 'index.html')))
  })

  it('the analytics tag Vercel serves is same-origin and therefore CSP-covered', () => {
    assert.match(VERCEL_INSIGHTS, /^\//)
    assert.doesNotMatch(VERCEL_INSIGHTS, /^https?:/)
  })

  it('the docs state the CSP forbids inline/eval scripts and allows inline styles for the per-value overrides', () => {
    assert.match(docsText, /script-src[\s\S]{0,200}'self'|no inline[\s\S]{0,80}script|forbids inline[\s\S]{0,80}script/i)
    assert.match(docsText, /inline styles?[\s\S]{0,80}(--size|--tone)|(--size|--tone)[\s\S]{0,80}inline styles?/i)
  })
})

describe('security headers drift', () => {
  before(seed)

  it('hono no longer serves html', async () => {
    for (const path of ['/', '/como-ler', '/sobre', '/atlas.html', '/bundle.js']) {
      const res = await app.request(path)
      assert.equal(res.status, 404, path)
      for (const key of Object.keys(SECURITY_HEADERS)) assert.equal(res.headers.get(key), null, `${path} carries ${key}`)
    }
  })

  it('hono sends none of the page headers on the API', async () => {
    const res = await app.request('/api/people')
    assert.equal(res.status, 200)
    for (const key of Object.keys(SECURITY_HEADERS)) assert.equal(res.headers.get(key), null, `/api/people carries ${key}`)
  })

  it('the docs say both copies exist and which test binds them', () => {
    assert.match(docsText, /src\/headers\.ts/)
    assert.match(docsText, /security-headers-acceptance\.test\.ts/)
  })
})

describe('the prerendered pages carry the script-src policy in a meta tag', () => {
  const built = ROUTES.map((r) => ({ path: r.path, file: join(root, 'build', r.path === '/' ? 'index.html' : `${r.path.slice(1)}.html`) }))
  const skip = built.every((b) => existsSync(b.file)) ? false : 'run pnpm build first'

  it('each page has one CSP meta: script-src is self plus hashes, style-src keeps unsafe-inline and no hash', { skip }, () => {
    for (const { path, file } of built) {
      const html = readFileSync(file, 'utf8')
      const metas = [...html.matchAll(/<meta\s+http-equiv="content-security-policy"\s+content="([^"]*)"/gi)]
      assert.equal(metas.length, 1, `${path} must carry exactly one CSP meta`)
      const directives = parseCsp(metas[0][1].replace(/&#39;/g, "'").replace(/&quot;/g, '"'))
      const script = directives.get('script-src') ?? []
      assert.ok(script.includes("'self'"), `${path}: script-src needs 'self'`)
      assert.ok(!script.includes("'unsafe-inline'"), `${path}: script-src must not allow unsafe-inline`)
      for (const token of script.filter((t) => t !== "'self'")) assert.match(token, /^'sha256-/, `${path}: unexpected script-src token ${token}`)
      const style = directives.get('style-src') ?? []
      assert.ok(style.includes("'unsafe-inline'"), `${path}: style-src needs unsafe-inline`)
      assert.ok(!style.some((t) => /sha256-|nonce-/.test(t)), `${path}: style-src must carry no hash or nonce`)
    }
  })
})

describe('the client bundle', () => {
  const appDir = join(root, 'build', '_app')
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))

  it('never ships graphology, which is server-only', { skip: existsSync(appDir) ? false : 'run pnpm build first' }, () => {
    for (const file of files(appDir)) assert.ok(!readFileSync(file, 'utf8').includes('graphology'), `${file} contains graphology`)
  })
})

describe('the CSP meta directives in svelte.config.js', () => {
  it('match the pinned list', async () => {
    // @ts-expect-error plain JS config, no declaration file
    const { default: config } = await import('../svelte.config.js')
    assert.deepEqual(config.kit.csp.directives, {
      'default-src': ['self'],
      'script-src': ['self'],
      'style-src': ['self', 'https://fonts.googleapis.com', 'unsafe-inline'],
      'font-src': ['https://fonts.gstatic.com'],
      'img-src': ['self', 'data:'],
      'connect-src': ['self'],
      'base-uri': ['self'],
      'object-src': ['none'],
    })
  })
})
