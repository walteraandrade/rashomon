import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { paintCandidates, paintOutlets, wordMarkup } from '../public/js/render.js'
import { inlineStyles, withFakeDocument } from './fake-dom.js'

// Independent verification of issue #37's acceptance criteria, written from the issue text
// and CLAUDE.md's module contract rather than from the builder's own modules. What has a
// module surface is imported and called; what is only observable over HTTP is requested from
// the app. design-5.html is read only to assert what it must NOT contain (a <style> block, an
// inline style=, an inline script) -- never to extract behaviour from it.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const jsDir = join(root, 'public', 'js')
const jsFiles = () => readdirSync(jsDir).filter((f) => f.endsWith('.js'))
const moduleSource = (name: string) => readFileSync(join(jsDir, name), 'utf8')
const design5 = () => readFileSync(join(root, 'public', 'design-5.html'), 'utf8')

// Both quote styles and both shapes: a cycle written as `from "./render.js"`, or as a
// multi-line `import {\n ... \n} from './render.js'`, must not slip through and pass vacuously.
const importsOf = (source: string) => [...source.matchAll(/(?:^|\n)(?:import\b|export\s*\{)[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('issue #37 AC1: the split page still serves the same atlas over the same routes', () => {
  it('GET / answers 200 and every module it needs is served as JavaScript', async () => {
    assert.equal((await app.request('/')).status, 200)
    for (const file of jsFiles()) {
      const res = await app.request(`/js/${file}`)
      assert.equal(res.status, 200, `/js/${file} must be served`)
      assert.match(res.headers.get('content-type') ?? '', /javascript/, `/js/${file} must be served with a JavaScript content type or the browser refuses the module`)
    }
    const css = await app.request('/atlas.css')
    assert.equal(css.status, 200)
    assert.match(css.headers.get('content-type') ?? '', /text\/css/)
  })

  it('api.js builds exactly the documented endpoints, with the same defaults the page used before the split', async () => {
    const { candidatesQuery, endpoint, params, sourcesParams } = await import('../public/js/api.js')
    assert.equal(endpoint('lula'), '/api/people/lula')
    const p = params({ days: '30', sort: 'count', limit: '18', source: 'all', domain: 'all' })
    assert.equal(p.toString(), new URLSearchParams({ days: '30', sort: 'count', limit: '18', min: '2', source: 'all', kind: 'all', domain: 'all' }).toString())
    // The outlet sidebar's own /sources call is the one that must not echo the domain back.
    assert.equal(sourcesParams({ days: '30', sort: 'count', limit: '18', source: 'all', domain: 'g1.globo.com' }).has('domain'), false)
    assert.equal(candidatesQuery({ days: '7' }).toString(), new URLSearchParams({ days: '7', min: '3', limit: '30' }).toString())
  })

  it('the docs panel narrows the graph querystring to one term and five rows', async () => {
    const { docsQuery } = await import('../public/js/app.js')
    const { params } = await import('../public/js/api.js')
    const base = params({ days: '30', sort: 'count', limit: '18', source: 'all', domain: 'all' })
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
    assert.match(html, /<script type="module" src="\.\/js\/app\.js"><\/script>/)
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
      paintOutlets({ rows: [{ domain: 'g1.globo.com', source: 'gnews', label: 'g1', docs: 4, tone: 1.5 }], domain: 'all', onPick: () => {} })
      paintCandidates({ candidates: [{ name: 'Hugo Motta', count: 5, sources: 2, previous: 0, samples: [{ id: '1', source: 'gnews', text: 'texto' }] }] })
      return els.outletList.innerHTML + els.candidateList.innerHTML
    })
    for (const value of inlineStyles(emitted)) assert.ok(value.startsWith('--'), `a painter emitted style="${value}"`)
    assert.match(emitted, /style="--tone:/, 'tone is the one genuinely dynamic value and stays a --var override')
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
      'app.js': ['./api.js', './format.js', './layout.js', './render.js', './state.js'],
    }
    assert.deepEqual(jsFiles().sort(), Object.keys(expected).sort(), 'every module in public/js must have a declared place in the import graph')
    for (const [file, allowed] of Object.entries(expected))
      assert.deepEqual(importsOf(moduleSource(file)).sort(), [...allowed].sort(), `${file} may only import ${allowed.join(', ') || 'nothing'}`)
  })

  it('the import scan really does see double-quoted and multi-line imports', () => {
    assert.deepEqual(importsOf(`import { a } from "./render.js"\nimport { b } from './layout.js'`), ['./render.js', './layout.js'])
    assert.deepEqual(importsOf(`import {\n  a,\n  b,\n} from "./state.js"`), ['./state.js'])
  })

  it('app.js is importable outside a browser: it wires nothing until boot() is called', async () => {
    const previous = (globalThis as { document?: unknown }).document
    assert.equal(previous, undefined, 'this suite must run with no document, or the import guard proves nothing')
    const module = await import('../public/js/app.js')
    assert.equal(typeof module.boot, 'function')
    assert.equal(typeof module.createHandlers, 'function')
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
