import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import * as renderModule from '../src/ui/render.js'
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
    // `kind` is the one default that moved since the split: the atlas names the three kinds it
    // wants instead of asking for all of them.
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
    for (const value of inlineStyles(String(word))) assert.ok(value.startsWith('--'), `wordMarkup emitted style="${value}"`)

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
      // The documents card and the in-page guide belong to no figure; both sit next to the
      // figures and are mounted by app.ts. help.ts has no imports: it only opens #helpDialog.
      'docs-card.ts': ['./api.js', './render.js', './state.js'],
      'help.ts': [],
      'figures/atlas.ts': ['./api.js', './docs-card.js', './format.js', './layout.js', './render.js', './state.js'],
      'figures/testimony.ts': ['./api.js', './docs-card.js', './format.js', './render.js', './state.js'],
      'figures/compare.ts': ['./api.js', './docs-card.js', './format.js', './render.js', './state.js'],
      'app.ts': ['./docs-card.js', './figures/atlas.js', './figures/compare.js', './figures/testimony.js', './help.js'],
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

// Issue #132: markup reaches innerHTML only through format.ts's html tag, so escaping is the
// tag's job and never a painter's discipline. The scan below walks each module's source with
// a small tokenizer (comments, quoted strings, regex literals, nested `${}`) and reports every
// template literal whose literal text looks like markup (`<tag`, `</tag`) yet is not tagged
// `html`. A regex over the raw file could not tell an inner untagged template from the tagged
// one that wraps it, and this is exactly the place a forgotten escape would hide.
type TemplateLiteral = { line: number; tagged: boolean; text: string }

export const templateLiterals = (source: string): TemplateLiteral[] => {
  const out: TemplateLiteral[] = []
  const line = (at: number) => source.slice(0, at).split('\n').length
  let i = 0
  // What came just before, ignoring whitespace: a `/` after an operand is division, otherwise
  // a regex literal that may carry quotes and backticks the scan must skip over.
  let last = ''
  const template = () => {
    const start = i
    const tagged = /html\s*$/.test(source.slice(0, start))
    let text = ''
    i++
    let depth = 0
    while (i < source.length) {
      const c = source[i]
      if (depth === 0) {
        if (c === '\\') {
          text += source[i + 1]
          i += 2
          continue
        }
        if (c === '`') {
          i++
          break
        }
        if (c === '$' && source[i + 1] === '{') {
          depth = 1
          i += 2
          continue
        }
        text += c
        i++
        continue
      }
      // Inside `${}`: the same tokens as top level, with braces counted so the expression's own
      // object literals and arrow bodies never end the interpolation early.
      if (c === '`') {
        template()
        continue
      }
      if (c === "'" || c === '"') {
        quoted(c)
        continue
      }
      if (c === '{') depth++
      if (c === '}') depth--
      i++
    }
    out.push({ line: line(start), tagged, text })
    last = '`'
  }
  const quoted = (q: string) => {
    i++
    while (i < source.length && source[i] !== q) i += source[i] === '\\' ? 2 : 1
    i++
    last = q
  }
  while (i < source.length) {
    const c = source[i]
    const two = source.slice(i, i + 2)
    if (two === '//') {
      i = source.indexOf('\n', i)
      if (i < 0) i = source.length
      continue
    }
    if (two === '/*') {
      i = source.indexOf('*/', i + 2) + 2
      continue
    }
    if (c === '`') {
      template()
      continue
    }
    if (c === "'" || c === '"') {
      quoted(c)
      continue
    }
    if (c === '/' && !/[\w)\]`'"]$/.test(last)) {
      i++
      let inClass = false
      while (i < source.length && (inClass || source[i] !== '/')) {
        if (source[i] === '\\') i++
        else if (source[i] === '[') inClass = true
        else if (source[i] === ']') inClass = false
        i++
      }
      i++
      last = '/'
      continue
    }
    if (!/\s/.test(c)) last = c
    i++
  }
  return out
}

const looksLikeMarkup = (text: string) => /<\/?[a-zA-Z]/.test(text)

describe('issue #132: markup reaches innerHTML only through the html tag', () => {
  it('the template scanner sees nesting, comments, strings and regex literals', () => {
    const found = templateLiterals("const a = html`<p>${x ? `<b>${y}</b>` : ''}</p>` // `<i>`\nconst r = /['\"`]/g\nconst s = '`<u>`'\nconst t = `plain ${'<'}`")
    assert.deepEqual(found.map((t) => [t.line, t.tagged, looksLikeMarkup(t.text)]), [[1, false, true], [1, true, true], [4, false, false]])
  })

  it('no module but format.ts calls esc(), and format.ts no longer exports it', async () => {
    for (const file of jsFiles()) if (file !== 'format.ts') assert.ok(!/\besc\s*\(/.test(moduleSource(file)), `${file} must not call esc(): the html tag escapes`)
    const format = await import('../src/ui/format.js')
    assert.equal('esc' in format, false)
    assert.equal(typeof format.html, 'function')
    assert.equal(typeof format.raw, 'function')
  })

  it('no innerHTML = or insertAdjacentHTML( in src/ui is fed by a plain backtick literal', () => {
    for (const file of jsFiles()) assert.ok(!/(?:innerHTML\s*=|insertAdjacentHTML\([^,]*,)\s*`/.test(moduleSource(file)), `${file} assigns a raw template literal to the DOM`)
  })

  it('every template literal that looks like markup is tagged html, in every module', () => {
    let tagged = 0
    for (const file of jsFiles())
      for (const t of templateLiterals(moduleSource(file))) {
        if (!looksLikeMarkup(t.text)) continue
        assert.ok(t.tagged, `${file}:${t.line} builds markup in an untagged template literal`)
        tagged++
      }
    assert.ok(tagged > 30, `the scan found only ${tagged} html-tagged templates; it is not seeing the painters`)
  })

  it('the html tag escapes what a painter forgets to: a document text with markup stays text', () => {
    withFakeDocument(['docs'], (els) => {
      const { paintDocs } = renderModule
      paintDocs([{ label: null, data: { total: 1, docs: [{ source: 'rss', domain: 'x.com', text: '<img src=x onerror=alert(1)>', uri: 'https://x.com/a' }] } }])
      assert.doesNotMatch(els.docs.innerHTML, /<img/)
      assert.match(els.docs.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/)
    })
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
})
