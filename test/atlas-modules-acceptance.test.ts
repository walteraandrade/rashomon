import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { paintCandidates, paintOutlets, wordMarkup } from '../src/ui/render.js'
import { inlineStyles, withFakeDocument } from './fake-dom.js'

// Independent verification of issue #37's acceptance criteria, written from the issue text
// and CLAUDE.md's module contract rather than from the builder's own modules. What has a
// module surface is imported and called; what is only observable over HTTP is requested from
// the app. design-5.html is read only to assert what it must NOT contain (a <style> block, an
// inline style=, an inline script) -- never to extract behaviour from it.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const jsDir = join(root, 'src', 'ui')
// Issue #92 adds src/ui/figures/*.ts: the walk must see that subdirectory too, so a new
// figure module is never invisible to the import-graph test or the "every module is served"
// check below.
const jsFiles = (dir = jsDir, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? jsFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : entry.name.endsWith('.ts') ? [`${prefix}${entry.name}`] : [],
  )
const moduleSource = (name: string) => readFileSync(join(jsDir, name), 'utf8')
const design5 = () => readFileSync(join(root, 'public', 'design-5.html'), 'utf8')

// Both quote styles and both shapes: a cycle written as `from "./render.js"`, or as a
// multi-line `import {\n ... \n} from './render.js'`, must not slip through and pass vacuously.
const importsOf = (source: string) => [...source.matchAll(/(?:^|\n)(?:import\b|export\s*\{)[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('issue #37 AC1: the split page still serves the same atlas over the same routes', () => {
  it('GET / answers 200 and the one script it needs is served as JavaScript', async () => {
    assert.equal((await app.request('/')).status, 200)
    // The modules are TypeScript under src/ui now: a browser cannot run them, so the bundle is
    // the only script public/ ships, and the sources must not be reachable over HTTP at all.
    const bundle = await app.request('/bundle.js')
    assert.equal(bundle.status, 200)
    assert.match(bundle.headers.get('content-type') ?? '', /javascript/)
    for (const file of jsFiles()) assert.equal((await app.request(`/js/${file}`)).status, 404, `/js/${file} must not be served`)
    const css = await app.request('/atlas.css')
    assert.equal(css.status, 200)
    assert.match(css.headers.get('content-type') ?? '', /text\/css/)
  })

  it('api.js builds exactly the documented endpoints, with the same defaults the page used before the split', async () => {
    const { candidatesQuery, endpoint, params, sourcesParams } = await import('../src/ui/api.js')
    assert.equal(endpoint('lula'), '/api/people/lula')
    const p = params({ days: '30', sort: 'count', limit: '18', source: 'all' })
    // `kind` is the one default that moved since the split: the atlas now names the kinds it
    // wants instead of asking for all of them, so GDELT's theme codes stay out of the map.
    assert.equal(p.toString(), new URLSearchParams({ days: '30', sort: 'count', limit: '18', min: '2', source: 'all', kind: 'word,hashtag,phrase', testimony: '1' }).toString())
    // No route ever hears about an outlet any more, the /sources call least of all.
    assert.equal(sourcesParams({ days: '30', sort: 'count', limit: '18', source: 'all' }).has('domain'), false)
    assert.equal(candidatesQuery({ days: '7' }).toString(), new URLSearchParams({ days: '7', min: '3', limit: '30' }).toString())
  })

  it('the docs panel narrows the graph querystring to one term and five rows', async () => {
    const { docsQuery } = await import('../src/ui/figures/atlas.js')
    const { params } = await import('../src/ui/api.js')
    const base = params({ days: '30', sort: 'count', limit: '18', source: 'all' })
    const forTerm = docsQuery(base, { id: 'reforma', term: 'reforma', kind: 'word', count: 4, pmi: 1 })
    assert.equal(forTerm.get('term'), 'reforma')
    assert.equal(forTerm.get('kind'), 'word')
    assert.equal(forTerm.get('limit'), '5')
    assert.equal(forTerm.get('days'), '30', 'the rest of the recorte must survive untouched')
    const forPerson = docsQuery(base, null)
    assert.equal(forPerson.get('term'), '')
    assert.equal(forPerson.get('kind'), 'all')
  })
})

describe('issue #37 AC2: design-5.html carries no styles and no logic of its own', () => {
  it('has no <style> block, no inline style= and no inline script body', () => {
    const html = design5()
    assert.doesNotMatch(html, /<style[\s>]/i, 'every rule belongs in public/atlas.css')
    assert.deepEqual(inlineStyles(html), [], 'no inline style= in the markup, not even a --var override')
    // An inline script body is what made the old page ungreppable-but-untestable; the page
    // may only reference a module file.
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    for (const [, attrs, body] of scripts) {
      assert.match(attrs, /\bsrc=/, `design-5.html must not carry an inline script body: ${body.slice(0, 80)}`)
      assert.equal(body.trim(), '')
    }
    assert.match(html, /<script type="module" src="\.\/bundle\.js"><\/script>/)
  })

  it('every style="..." the modules write is a CSS custom property, not a hardcoded declaration', () => {
    const offenders = jsFiles().flatMap((file) =>
      inlineStyles(moduleSource(file))
        .filter((value) => !value.trimStart().startsWith('--'))
        .map((value) => `${file}: style="${value}"`),
    )
    assert.deepEqual(offenders, [], 'issue #37 moves inline style= into atlas.css classes; only --var overrides for genuinely dynamic values may stay')
  })

  it('the markup the painters actually emit carries only --var overrides', () => {
    const word = wordMarkup({ id: 'a', term: 'reforma', kind: 'word', pmi: 1, rank: 0, x: 1, y: 2, w: 90, h: 30, size: 28, lineHeight: 33, lines: ['reforma'], count: 4, score: 4 }, 'count')
    for (const value of inlineStyles(word)) assert.ok(value.startsWith('--'), `wordMarkup emitted style="${value}"`)

    const emitted = withFakeDocument(['domainLabel', 'outletList', 'candidateLabel', 'candidateList'], (els) => {
      paintOutlets({
        rows: [{ domain: 'g1.globo.com', source: 'gnews', label: 'g1', docs: 4, tone: 1.5 }],
        testimony: { method: 'stub', overall: { score: -1, n: 4 }, by_source: [], by_domain: [{ domain: 'g1.globo.com', source: 'gnews', score: -1.5, n: 4 }] },
        domain: 'all',
        onPick: () => {},
      })
      paintCandidates({ candidates: [{ name: 'Hugo Motta', count: 5, sources: 2, previous: 0, samples: [{ id: '1', source: 'gnews', text: 'texto' }] }] })
      return els.outletList.innerHTML + els.candidateList.innerHTML
    })
    for (const value of inlineStyles(emitted)) assert.ok(value.startsWith('--'), `a painter emitted style="${value}"`)
    assert.match(emitted, /style="--tone:/, 'tone is the one genuinely dynamic value and stays a --var override')
  })
})

describe('issue #37 AC3/Layout: the module boundaries CLAUDE.md declares actually hold', () => {
  it('layout.js, format.js, state.js and api.js never touch the document', () => {
    for (const file of ['layout.ts', 'format.ts', 'state.ts', 'api.ts'])
      assert.ok(!/\bdocument\b/.test(moduleSource(file)), `${file} must stay DOM-free so it is importable under node:test`)
  })

  it('render.js never fetches and api.js never renders', () => {
    assert.ok(!/\bfetch\s*\(/.test(moduleSource('render.ts')), 'render.js paints; it must not fetch')
    assert.ok(!/\bdocument\b/.test(moduleSource('api.ts')), 'api.js fetches; it must not render')
  })

  it('AC2: the import graph is acyclic and matches the documented direction, including src/ui/figures/', () => {
    const expected: Record<string, string[]> = {
      'format.ts': [],
      'state.ts': [],
      'api.ts': [],
      'layout.ts': ['./format.js'],
      'render.ts': ['./format.js', './layout.js'],
      // The documents card belongs to no figure since all three open it, so it sits one layer
      // above render.js and below figures/: it fetches, paints and owns #docsDialog.
      'docs-card.ts': ['./api.js', './render.js', './state.js'],
      'figures/atlas.ts': ['./api.js', './docs-card.js', './format.js', './layout.js', './render.js', './state.js'],
      'figures/testimony.ts': ['./api.js', './docs-card.js', './format.js', './render.js', './state.js'],
      'figures/compare.ts': ['./api.js', './docs-card.js', './format.js', './render.js', './state.js'],
      'app.ts': ['./docs-card.js', './figures/atlas.js', './figures/testimony.js', './figures/compare.js'],
    }
    assert.deepEqual(jsFiles().sort(), Object.keys(expected).sort(), 'every module in src/ui must have a declared place in the import graph')
    for (const [file, allowed] of Object.entries(expected)) {
      // A module under figures/ imports its siblings (../api.js, not ./api.js); importsOf
      // returns the literal specifier, so this resolves each one relative to its own file
      // before comparing, the same way the loader would.
      const resolved = importsOf(moduleSource(file)).map((spec) => (file.includes('/') && spec.startsWith('../') ? `.${spec.slice(2)}` : spec))
      assert.deepEqual(resolved.sort(), [...allowed].sort(), `${file} may only import ${allowed.join(', ') || 'nothing'}`)
    }
  })

  it('the import scan really does see double-quoted and multi-line imports', () => {
    assert.deepEqual(importsOf(`import { a } from "./render.js"\nimport { b } from './layout.js'`), ['./render.js', './layout.js'])
    assert.deepEqual(importsOf(`import {\n  a,\n  b,\n} from "./state.js"`), ['./state.js'])
  })

  it('AC3: app.js is importable outside a browser and exposes exactly one export, boot', async () => {
    const previous = (globalThis as { document?: unknown }).document
    assert.equal(previous, undefined, 'this suite must run with no document, or the import guard proves nothing')
    const module = await import('../src/ui/app.js')
    assert.deepEqual(Object.keys(module), ['boot'], 'app.js is a shell now: every other export moved into the figure that owns it')
    assert.equal(typeof module.boot, 'function')
  })

  it('AC1: public/js/figures/atlas.js and figures/testimony.js are importable outside a browser too', async () => {
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document')
    const atlas = await import('../src/ui/figures/atlas.js')
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/atlas.js must not touch document at import time')
    assert.equal(typeof atlas.mount, 'function')
    const testimony = await import('../src/ui/figures/testimony.js')
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/testimony.js must not touch document at import time')
    assert.equal(typeof testimony.mount, 'function')
  })

  it('AC4: figures/atlas.js and state.js export exactly what the split promises, no more', async () => {
    const atlas = await import('../src/ui/figures/atlas.js')
    assert.deepEqual(Object.keys(atlas).sort(), ['createHandlers', 'docsQuery', 'layoutKey', 'mount', 'scopeKeys'].sort())
    const state = await import('../src/ui/state.js')
    for (const name of ['fromScope', 'debounce', 'readScope', 'writeScope', 'clearScopes', 'SCOPE_TTL_MS', 'SCOPE_LIMIT']) assert.equal(typeof (state as Record<string, unknown>)[name] !== 'undefined', true, `state.js must still export ${name}`)
    for (const name of ['outlet', 'zoom', 'layoutCache', 'mask', 'getController', 'setController', 'getMask', 'setMask']) assert.equal(name in state, false, `state.js must not export ${name}: it is figure-private now`)
    const testimony = await import('../src/ui/figures/testimony.js')
    assert.deepEqual(Object.keys(testimony), ['mount'], 'figures/testimony.js exposes only mount; outlet/zoom/layoutCache/mask/request-id bookkeeping stay local')
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
