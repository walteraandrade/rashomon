import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'

// Independent verification of issue #37's acceptance criteria, written from the issue text
// and CLAUDE.md's module contract rather than from the builder's own modules. Deliberately
// never reads public/design-5.html as text (AC3); what has a module surface is imported and
// called, what is only observable over HTTP is requested from the app.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const jsDir = join(root, 'public', 'js')
const moduleSource = (name: string) => readFileSync(join(jsDir, name), 'utf8')

const importsOf = (source: string) => [...source.matchAll(/(?:^|\n)\s*(?:import|export)[^\n]*?from\s+'([^']+)'/g)].map((m) => m[1])

describe('issue #37 AC1: the split page still serves the same atlas over the same routes', () => {
  it('GET / answers 200 and every module it needs is served as JavaScript', async () => {
    assert.equal((await app.request('/')).status, 200)
    for (const file of ['api.js', 'layout.js', 'render.js', 'state.js', 'format.js']) {
      const res = await app.request(`/js/${file}`)
      assert.equal(res.status, 200, `/js/${file} must be served`)
      assert.match(res.headers.get('content-type') ?? '', /javascript/, `/js/${file} must be served with a JavaScript content type or the browser refuses the module`)
    }
    const css = await app.request('/atlas.css')
    assert.equal(css.status, 200)
    assert.match(css.headers.get('content-type') ?? '', /text\/css/)
  })

  it('api.js builds exactly the four documented endpoints, with the same defaults the page used before the split', async () => {
    const { endpoint, params, sourcesParams } = await import('../public/js/api.js')
    assert.equal(endpoint('lula'), '/api/people/lula')
    const p = params({ days: '30', sort: 'count', limit: '18', source: 'all', domain: 'all' })
    assert.equal(p.toString(), new URLSearchParams({ days: '30', sort: 'count', limit: '18', min: '2', source: 'all', kind: 'all', domain: 'all' }).toString())
    // The outlet sidebar's own /sources call is the one that must not echo the domain back.
    assert.equal(sourcesParams({ days: '30', sort: 'count', limit: '18', source: 'all', domain: 'g1.globo.com' }).has('domain'), false)
  })
})

describe('issue #37 AC2: no inline style= in the emitted markup beyond a --var override', () => {
  it('every style="..." the modules write is a CSS custom property, not a hardcoded declaration', () => {
    const offenders = readdirSync(jsDir)
      .filter((f) => f.endsWith('.js'))
      .flatMap((file) =>
        [...moduleSource(file).matchAll(/style="([^"]*)"/g)]
          .filter((m) => !m[1].trimStart().startsWith('--'))
          .map((m) => `${file}: style="${m[1]}"`),
      )
    assert.deepEqual(offenders, [], 'issue #37 moves inline style= into atlas.css classes; only --var overrides for genuinely dynamic values may stay')
  })
})

describe('issue #37 AC3/Layout: the module boundaries CLAUDE.md declares actually hold', () => {
  it('layout.js, format.js, state.js and api.js never touch the document', () => {
    for (const file of ['layout.js', 'format.js', 'state.js', 'api.js'])
      assert.ok(!/\bdocument\b/.test(moduleSource(file)), `${file} must stay DOM-free so it is importable under node:test`)
  })

  it('render.js never fetches and api.js never renders', () => {
    assert.ok(!/\bfetch\s*\(/.test(moduleSource('render.js')), 'render.js paints; it must not fetch')
    assert.ok(!/\bdocument\b/.test(moduleSource('api.js')), 'api.js fetches; it must not render')
  })

  it('the import graph is acyclic and matches the documented direction', () => {
    const expected: Record<string, string[]> = {
      'format.js': [],
      'state.js': [],
      'api.js': [],
      'layout.js': ['./format.js'],
      'render.js': ['./format.js', './layout.js'],
    }
    for (const [file, allowed] of Object.entries(expected))
      assert.deepEqual(importsOf(moduleSource(file)).sort(), [...allowed].sort(), `${file} may only import ${allowed.join(', ') || 'nothing'}`)
  })
})

describe('issue #37 AC4: public/ only holds files that are served on purpose', () => {
  it('every file left in public/ answers 200 by name', async () => {
    for (const entry of readdirSync(join(root, 'public'), { withFileTypes: true })) {
      if (entry.isDirectory()) continue
      const res = await app.request(`/${entry.name}`)
      assert.equal(res.status, 200, `public/${entry.name} is shipped but not reachable`)
    }
  })

  it('the archived design alternatives are gone from public/ and 404 over HTTP', async () => {
    const shipped = readdirSync(join(root, 'public'))
    for (const name of ['design-1.html', 'design-2.html', 'design-3.html', 'design-4.html', 'design-6.html', 'designs.html', 'graph-lab.html', 'graph-lab.md', 'graph-circle-lab.html', 'graph-circle-lab.md']) {
      assert.ok(!shipped.includes(name), `${name} must live in docs/designs/, not public/`)
      assert.equal((await app.request(`/${name}`)).status, 404)
    }
  })
})
