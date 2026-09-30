import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { app } from '../src/server.js'
import { inlineStyles, withFakeDocument } from './fake-dom.js'
import { pageMarkup, pageSource, ROUTES } from './pages.js'
import { paintCandidates, paintDocs, paintOutlets, wordMarkup } from '../src/ui/render.js'

// Repo-wide invariants: shapes the whole codebase must hold, not one issue's acceptance
// criteria. A block here checks a structural rule (an import graph, a module boundary, a
// markup-escaping discipline) by importing and calling the real modules or by reading source
// text for a repo-wide pattern -- never by asserting that one function calls another by name.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const testDir = join(root, 'test')
const jsDir = join(root, 'src', 'ui')
// src/ui/figures/*.ts sits one level deeper: the walk must see that subdirectory too, so a new
// figure module is never invisible to the import-graph test or the "every module is served"
// check below.
const jsFiles = (dir = jsDir, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? jsFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : entry.name.endsWith('.ts') ? [`${prefix}${entry.name}`] : [],
  )
const moduleSource = (name: string) => readFileSync(join(jsDir, name), 'utf8')
const atlasPage = () => pageMarkup('/')
const testFileNames = () => readdirSync(testDir).filter((f) => f.endsWith('.test.ts'))
const testFileSource = (name: string) => readFileSync(join(testDir, name), 'utf8')

// Every .ts file under src/, walked recursively -- used only for the node:https check below,
// which is a repo-wide constraint (the whole collector layer runs on Effect's HttpClient) and
// not one module's own text.
const srcDir = join(root, 'src')
const srcFiles = (dir = srcDir, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? srcFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : entry.name.endsWith('.ts') ? [`${prefix}${entry.name}`] : [],
  )
const srcSource = (name: string) => readFileSync(join(srcDir, name), 'utf8')

// Both quote styles and both shapes: a cycle written as `from "./render.js"`, or as a
// multi-line `import {\n ... \n} from './render.js'`, must not slip through and pass vacuously.
const importsOf = (source: string) => [...source.matchAll(/(?:^|\n)(?:import\b|export\s*\{)[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('hono no longer serves the site', () => {
  it('hono answers 404 for site paths', async () => {
    for (const path of ['/', '/como-ler', '/sobre', '/atlas.html', '/como-ler.html', '/sobre.html', '/atlas.css', '/bundle.js'])
      assert.equal((await app.request(path)).status, 404, `${path} must not be served by the Hono app`)
  })

  it('no TypeScript source under src/ui is reachable at /js/<file>', async () => {
    for (const file of jsFiles()) assert.equal((await app.request(`/js/${file}`)).status, 404, `/js/${file} must not be served`)
  })

  it('every file in public/ is an asset the build copies, not a page or a script', () => {
    for (const entry of readdirSync(join(root, 'public'), { withFileTypes: true }))
      assert.doesNotMatch(entry.name, /\.(html|js|ts)$/, `public/${entry.name} must not ship a page or a script`)
  })
})

describe('the client output stays free of the server graph libraries', () => {
  it('no module under src/ui imports graphology', () => {
    for (const file of jsFiles()) assert.ok(!/graphology/.test(importsOf(moduleSource(file)).join(' ')), `${file} must not import graphology`)
  })
})

describe('the esbuild bundle is gone', () => {
  it('bundle.js, its freshness test and the esbuild script no longer exist and nothing refers to them', () => {
    assert.equal(existsSync(join(root, 'public', 'bundle.js')), false)
    assert.equal(existsSync(join(testDir, 'bundle-freshness.test.ts')), false)
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts.build, 'vite build')
    assert.doesNotMatch(JSON.stringify(pkg), /esbuild/)
    const needle = ['public', 'bundle.js'].join('/')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    const files = ['src', 'scripts', 'test', 'docs'].flatMap((d) => walk(join(root, d))).filter((f) => /\.(ts|md|js|json|svelte)$/.test(f))
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes(needle)).map((f) => f.slice(root.length + 1))
    assert.deepEqual(offenders, [], 'nothing may refer to the deleted bundle')
  })
})

describe('the pages under web/ carry no styles and no logic of their own', () => {
  it('has no <style> block, no inline style= and no inline script in any page', () => {
    for (const { file, path } of ROUTES) {
      const html = pageSource(path)
      assert.doesNotMatch(html, /<style[\s>]/i, `${file}: every rule belongs in public/atlas.css`)
      assert.deepEqual(inlineStyles(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')), [], `${file}: no inline style= in the markup`)
      const markup = html.replace(/<script\s+lang="ts"[^>]*>[\s\S]*?<\/script>/, '')
      assert.doesNotMatch(markup, /<script\b/i, `${file}: no inline script beyond the one component script block`)
      assert.doesNotMatch(markup, /\b(?:href|src)="[^"#:]*\.html(?:#[^"]*)?"/, `${file}: an internal link must be a route, never *.html`)
    }
  })

  it('every style="..." the modules write is a CSS custom property, not a hardcoded declaration', () => {
    const offenders = jsFiles().flatMap((file) =>
      inlineStyles(moduleSource(file))
        .filter((value) => !value.trimStart().startsWith('--'))
        .map((value) => `${file}: style="${value}"`),
    )
    assert.deepEqual(offenders, [], 'inline style= only ever belongs to a --var override for a genuinely dynamic value; everything else lives in atlas.css')
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

describe('every page parses the way it is written', () => {
  // The HTML parser silently repairs markup the source never meant: a <div> inside a <p> closes
  // the <p> right there, so everything after it leaves the sentence and an absolute child loses
  // its positioned parent. A repaired element shows up as one with no start tag (implied) or,
  // though not void and not self-closed, no end tag.
  type Element = DefaultTreeAdapterMap['element']
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
  const elements = (node: { childNodes?: unknown[]; content?: unknown }): Element[] => {
    const own = 'tagName' in node ? [node as Element] : []
    const children = [...(node.childNodes ?? []), ...(node.content ? [node.content] : [])] as Element[]
    return [...own, ...children.flatMap(elements)]
  }
  const repairs = (source: string) =>
    elements(parse(source, { sourceCodeLocationInfo: true })).flatMap((el) => {
      const loc = el.sourceCodeLocation
      if (!loc) return [`<${el.tagName}> the source never opened`]
      const selfClosed = source.slice(loc.startTag!.startOffset, loc.startTag!.endOffset).endsWith('/>')
      return VOID.has(el.tagName) || selfClosed || loc.endTag ? [] : [`<${el.tagName}> at line ${loc.startLine} closed by the parser, not by its own end tag`]
    })

  it('flags a block element inside a <p>', () => {
    const page = '<!doctype html><html><head></head><body>\n<p>a <span><div></div></span> b</p>\n</body></html>'
    assert.deepEqual(repairs(page), [
      '<p> at line 2 closed by the parser, not by its own end tag',
      '<span> at line 2 closed by the parser, not by its own end tag',
      '<p> the source never opened',
    ])
  })

  it('no page under web/ needs the parser to repair it', () => {
    for (const { path, file } of ROUTES) {
      const markup = pageMarkup(path).replace(/<svelte:head>[\s\S]*?<\/svelte:head>/, '')
      assert.deepEqual(repairs(`<!doctype html><html><head></head><body>\n${markup}\n</body></html>`), [], file)
    }
  })
})

describe('the module boundaries CLAUDE.md declares actually hold', () => {
  it('layout.js, format.js, state.js, perf.js, api.js and marks.js never touch the document', () => {
    for (const file of ['layout.ts', 'format.ts', 'state.ts', 'perf.ts', 'api.ts', 'marks.ts'])
      assert.ok(!/\bdocument\b/.test(moduleSource(file)), `${file} must stay DOM-free so it is importable under node:test`)
  })

  it('render.js never fetches and api.js never renders', () => {
    assert.ok(!/\bfetch\s*\(/.test(moduleSource('render.ts')), 'render.js paints; it must not fetch')
    assert.ok(!/\bdocument\b/.test(moduleSource('api.ts')), 'api.js fetches; it must not render')
  })

  it('the import graph is acyclic and matches the documented direction, including src/ui/figures/', () => {
    const expected: Record<string, string[]> = {
      // Issue #208: figure 8's grid needs a domain's lean for its badge, and the route itself
      // carries no lean field (out of scope for that issue), so agendaRows reads outlets.json
      // directly -- a data import, not a ui-module one, so it adds no edge to the acyclic
      // module graph this test otherwise enforces.
      'format.ts': ['../../outlets.json'],
      'state.ts': ['./perf.js'],
      'perf.ts': [],
      'api.ts': ['./perf.js'],
      'layout.ts': ['./format.js'],
      // The SVG frame/axis/overflow-list builders render.ts once hand-wrote per figure live in
      // their own DOM-free module, imported only by render.ts.
      'marks.ts': ['./format.js'],
      // The searchable face over a <select> (figure 6's two lens controls): DOM-level, but
      // builds its list with format.ts's tag only and never fetches or paints a figure.
      'combobox.ts': ['./format.js'],
      'render.ts': ['./format.js', './layout.js', './marks.js'],
      // The documents card and the in-page guide belong to no figure; both sit next to the
      // figures and are mounted by app.ts. help.ts has no imports: it only opens #helpDialog.
      'docs-card.ts': ['./api.js', './perf.js', './render.js', './state.js'],
      'help.ts': [],
      // The shared runtime behind four of the five mount() calls (issue #193): abort/stale/
      // scope/ghost/background-click/Escape/resize, generalized out of compare.ts/rising.ts/
      // week.ts/testimony.ts. It builds no markup and never fetches on its own, so it imports
      // neither format.js nor render.js; docs-card.js is what lets release() close only the
      // card its own name opened.
      'figure.ts': ['./docs-card.js', './perf.js', './state.js'],
      'figures/atlas.ts': ['./api.js', './docs-card.js', './format.js', './layout.js', './perf.js', './render.js', './state.js'],
      // testimony.ts, compare.ts, rising.ts and week.ts adopt figure.ts and drop their own
      // direct perf.js/state.js imports: the span and the scope/debounce calls now live inside
      // the shared runtime.
      'figures/testimony.ts': ['./api.js', './docs-card.js', './figure.js', './format.js', './render.js'],
      'figures/compare.ts': ['./api.js', './docs-card.js', './figure.js', './format.js', './render.js'],
      // Figure 4, the rising ruler: same shape as figures/compare.ts, imported by nothing but
      // app.ts, and reaching into no other figure's DOM.
      'figures/rising.ts': ['./api.js', './docs-card.js', './figure.js', './format.js', './render.js'],
      // Figure 5, the week: same shape again, imported by nothing but app.ts.
      'figures/week.ts': ['./api.js', './docs-card.js', './figure.js', './format.js', './layout.js', './render.js'],
      // Figure 6 (issue #206), the lenses ruler: same shape as figures/compare.ts, imported by
      // nothing but app.ts, and reaching into no other figure's DOM.
      'figures/lenses.ts': ['./api.js', './combobox.js', './docs-card.js', './figure.js', './format.js', './render.js'],
      // Figure 7 (issue #216), attention vs mentions: same shape as figures/lenses.ts, imported
      // by nothing but app.ts, and reaching into no other figure's DOM.
      'figures/attention.ts': ['./api.js', './docs-card.js', './figure.js', './format.js', './render.js'],
      // Figure 8 (issue #208), the agenda grid: same shape again, imported by nothing but
      // app.ts, and reaching into no other figure's DOM.
      'figures/agenda.ts': ['./api.js', './docs-card.js', './figure.js', './format.js', './render.js'],
      // Figure 9 (#207), the comention matrix: same shape again, imported by nothing but app.ts.
      'figures/comention.ts': ['./api.js', './docs-card.js', './figure.js', './format.js', './render.js'],
      'figures/persistence.ts': ['./api.js', './docs-card.js', './figure.js', './format.js', './render.js'],
      'app.ts': [
        './api.js',
        './docs-card.js',
        './figures/agenda.js',
        './figures/atlas.js',
        './figures/attention.js',
        './figures/comention.js',
        './figures/compare.js',
        './figures/lenses.js',
        './figures/persistence.js',
        './figures/rising.js',
        './figures/testimony.js',
        './figures/week.js',
        './help.js',
        './render.js',
      ],
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

  it('app.js is importable outside a browser and exposes exactly one export, boot', async () => {
    const previous = (globalThis as { document?: unknown }).document
    assert.equal(previous, undefined, 'this suite must run with no document, or the import guard proves nothing')
    const module = await import('../src/ui/app.js')
    assert.deepEqual(Object.keys(module), ['boot'], 'app.js is a shell now: every other export moved into the figure that owns it')
    assert.equal(typeof module.boot, 'function')
  })

  it('figures/atlas.js and figures/testimony.js are importable outside a browser too', async () => {
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document')
    const atlas = await import('../src/ui/figures/atlas.js')
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/atlas.js must not touch document at import time')
    assert.equal(typeof atlas.mount, 'function')
    const testimony = await import('../src/ui/figures/testimony.js')
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/testimony.js must not touch document at import time')
    assert.equal(typeof testimony.mount, 'function')
  })

  it('figures/atlas.js and state.js export exactly what the split promises, no more', async () => {
    const atlas = await import('../src/ui/figures/atlas.js')
    assert.deepEqual(Object.keys(atlas).sort(), ['createHandlers', 'docsQuery', 'layoutKey', 'mount', 'scopeKeys'].sort())
    const state = await import('../src/ui/state.js')
    for (const name of ['fromScope', 'debounce', 'readScope', 'writeScope', 'clearScopes', 'SCOPE_TTL_MS', 'SCOPE_LIMIT']) assert.equal(typeof (state as Record<string, unknown>)[name] !== 'undefined', true, `state.js must still export ${name}`)
    for (const name of ['outlet', 'zoom', 'layoutCache', 'mask', 'getController', 'setController', 'getMask', 'setMask']) assert.equal(name in state, false, `state.js must not export ${name}: it is figure-private now`)
    const testimony = await import('../src/ui/figures/testimony.js')
    assert.deepEqual(Object.keys(testimony), ['mount'], 'figures/testimony.js exposes only mount; outlet/zoom/layoutCache/mask/request-id bookkeeping stay local')
  })
})

// Markup reaches innerHTML only through format.ts's html tag, so escaping is the tag's job and
// never a painter's discipline. The scan below walks each module's source with a small
// tokenizer (comments, quoted strings, regex literals, nested `${}`) and reports every template
// literal whose literal text looks like markup (`<tag`, `</tag`) yet is not tagged `html`. A
// regex over the raw file could not tell an inner untagged template from the tagged one that
// wraps it, and this is exactly the place a forgotten escape would hide.
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

describe('markup reaches innerHTML only through the html tag', () => {
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
      paintDocs([{ label: null, data: { total: 1, docs: [{ source: 'rss', domain: 'x.com', text: '<img src=x onerror=alert(1)>', uri: 'https://x.com/a' }] } }])
      assert.doesNotMatch(els.docs.innerHTML, /<img/)
      assert.match(els.docs.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/)
    })
  })
})

// The two structural rules a rewrite could quietly violate: a test proves behaviour by calling
// the real code, not by pattern-matching another module's source text for its own
// implementation choices (which function it calls, how many literal tags it writes), and no
// label announces "which issue" instead of "what this checks". Self-checking here, rather than
// only in code review, so the next PR that adds a pin or an issue-numbered label fails its own
// build instead of drifting back.
describe('the test suite stays behaviour-first: no source-scanning pins, no issue-numbered labels', () => {
  it('no test file regex-scans another module\'s source for a specific call, a literal tag count, or an export body pulled out by string search', () => {
    // Built by concatenation, not written as a literal, so this file's own occurrence of the
    // pattern (right here) never trips the scan over itself.
    const forbidden = [['frame', String.raw`\s*\(`].join(''), ['axis', String.raw`\s*\(`].join(''), ['<svg\\b', '/g'].join(''), ['export const ', '${name}'].join('')]
    for (const file of testFileNames()) {
      if (file === 'invariants.test.ts') continue
      const src = testFileSource(file)
      for (const pattern of forbidden) assert.ok(!src.includes(pattern), `${file} must not contain the forbidden pin ${JSON.stringify(pattern)}`)
    }
  })

  it('only invariants.test.ts and docs-drift.test.ts read src/ui source text', () => {
    const allowed = new Set(['invariants.test.ts', 'docs-drift.test.ts'])
    const readsSource = /moduleSource\(|readFileSync\([^)]*src\/ui/
    for (const file of testFileNames()) {
      if (allowed.has(file)) continue
      assert.ok(!readsSource.test(testFileSource(file)), `${file} must not read src/ui source text directly`)
    }
  })

  it('no describe or it label opens with an AC number or "issue #"', () => {
    const offenders: string[] = []
    for (const file of testFileNames()) {
      const src = testFileSource(file)
      for (const m of src.matchAll(/^\s*(?:describe|it)\(\s*['"`](AC[0-9]|issue #)/gm)) offenders.push(`${file}: ${m[0].trim()}`)
    }
    assert.deepEqual(offenders, [], 'no describe(...)/it(...) label may start with AC<digit> or "issue #"')
  })
})

describe('the collector layer runs on Effect\'s HttpClient, not node:https', () => {
  it('no file under src/ imports node:https', () => {
    for (const file of srcFiles()) assert.doesNotMatch(srcSource(file), /from\s+['"]node:https['"]|require\(['"]node:https['"]\)/, `${file} must not import node:https`)
  })

  it('collectors-press.test.ts is gone, its facts folded into collectors-rss.test.ts', () => {
    assert.ok(!testFileNames().includes('collectors-press.test.ts'))
  })
})

describe('the managed database driver is @effect/sql-pg, not pg', () => {
  it('no file under src/ imports pg directly, except push.ts (its own one-shot copy target)', () => {
    for (const file of srcFiles()) {
      if (file === 'push.ts') continue
      assert.doesNotMatch(srcSource(file), /from\s+['"]pg['"]|require\(['"]pg['"]\)/, `${file} must not import pg`)
    }
  })
})

// Strips `//` line comments so a mention inside a comment (explaining why a fragment lives
// in scoring.ts) never counts as the fragment itself living outside it.
const withoutLineComments = (source: string) =>
  source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

describe('the pmi ordering, signature floor and own-name filter live only in src/scoring.ts', () => {
  it('src/scoring.ts is the only file under src/ with the pmi formula or the signature floor outside a comment', () => {
    for (const file of srcFiles()) {
      if (file === 'scoring.ts') continue
      const code = withoutLineComments(srcSource(file))
      assert.ok(!code.includes('pmi * ln(1 + '), `${file} must not inline the pmi formula outside scoring.ts`)
      assert.ok(!code.includes('greatest(3,'), `${file} must not inline the signature floor outside scoring.ts`)
    }
  })

  it('no file under src/ declares namePhrase or a local const sortKey', () => {
    for (const file of srcFiles()) {
      const code = srcSource(file)
      assert.ok(!/\bnamePhrase\b/.test(code), `${file} must not declare namePhrase`)
      if (file !== 'scoring.ts') assert.ok(!/const sortKey\s*=/.test(code), `${file} must not declare a local sortKey`)
    }
  })

  it('CLAUDE.md names src/scoring.ts as where the pmi ordering, signature floor and own-name filter live', () => {
    const claudeMd = srcSource('../CLAUDE.md')
    const scoringSentence = claudeMd.split('\n').find((line) => line.includes('`src/scoring.ts`') && line.includes('pmi'))
    assert.ok(scoringSentence, 'CLAUDE.md must describe src/scoring.ts and the pmi ordering together')
  })
})

// AC12 (issue #207): CLAUDE.md's public/atlas.html bullet is exhaustive over every figure on
// the page, so a builder who adds one without updating it leaves the repo's own map of itself
// wrong. The spec drafted this criterion naming "six" figures, before issue #206's lenses ruler
// landed as figure 6; the fact worth pinning is that the enumeration is exhaustive and current
// (matching the real figure count on the page) and names #comention with its DOM id and its
// docs-card entry point at the same level of detail every other figure gets there -- not the
// stale literal count, which the spec fixed before #206 shipped.
describe('CLAUDE.md documents the comention figure (issue #207)', () => {
  const claudeMd = () => srcSource('../CLAUDE.md')
  // The whole bullet is one very long line, so a per-line split (used for src/scoring.ts above)
  // cannot isolate one figure's own clause -- windowed regexes anchored on `#comention` instead.
  const figureIds = () => [...atlasPage().matchAll(/class="figure[^"]*"\s+id="([a-z]+)"/g)].map(([, id]) => id)

  it("CLAUDE.md's atlas.html bullet enumerates every .figure section actually on the page, comention included", () => {
    const ids = figureIds()
    assert.ok(ids.includes('comention'), 'web/routes/+page.svelte must carry a #comention .figure section')
    const md = claudeMd()
    for (const id of ids) assert.match(md, new RegExp('`#' + id + '`'), `CLAUDE.md's atlas.html bullet must name #${id}`)
  })

  it('names #comention as a 27×27 half-matrix from GET /api/comention, ink-weight only (exposure, not evaluation)', () => {
    const md = claudeMd()
    assert.match(md, /`#comention`[\s\S]{0,80}27×27 half-matrix/)
    assert.match(md, /`#comention`[\s\S]{0,300}GET \/api\/comention/)
    assert.match(md, /`#comention`[\s\S]{0,400}`--ink` only/)
    assert.match(md, /`#comention`[\s\S]{0,700}exposure, not evaluation/)
  })

  it("describes #comention's docs-card entry point: a filled cell opens one side via with=, never two columns", () => {
    const md = claudeMd()
    assert.match(md, /`#comention`[\s\S]{0,1000}one side[\s\S]{0,150}with=/)
    assert.match(md, /`#comention`[\s\S]{0,1000}never two columns/)
  })
})

describe('CLAUDE.md documents the persistence figure', () => {
  const md = () => srcSource('../CLAUDE.md')

  it('names the term_weeks table, its build, the route builders, the figure module and its layout function (AC23)', () => {
    for (const name of ['term_weeks', 'buildTermWeeks', 'persistenceFirstWeek', 'persistenceFor', 'persistenceStats', 'figures/persistence.ts', 'persistenceLayout', '`#persistence`']) {
      assert.ok(md().includes(name), `CLAUDE.md must name ${name}`)
    }
  })

  it('counts ten figures on the page, the tenth being the persistence card (AC23)', () => {
    assert.match(md(), /sequence of ten `\.figure` cards/)
    assert.doesNotMatch(md(), /sequence of nine `\.figure` cards/)
  })
})

describe('the warm store\'s Blob writer is out of the server\'s reach', () => {
  const relativeImports = (file: string) =>
    importsOf(srcSource(file))
      .filter((spec) => spec.startsWith('.'))
      .map((spec) => join(dirname(file), spec.replace(/\.js$/, '.ts')).replace(/\\/g, '/'))

  const closure = (entry: string) => {
    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const next of relativeImports(file)) visit(next)
    }
    visit(entry)
    return [...seen]
  }

  it('only src/warmstore-blob.ts imports @vercel/blob', () => {
    const importers = srcFiles().filter((file) => /from\s+['"]@vercel\/blob['"]/.test(srcSource(file)))
    assert.deepEqual(importers, ['warmstore-blob.ts'])
  })

  it('nothing src/server.ts imports, transitively, is src/warmstore-blob.ts or imports @vercel/blob', () => {
    const reached = closure('server.ts')
    assert.ok(reached.includes('warmstore.ts'), 'the walk really reaches the store reader')
    assert.ok(!reached.includes('warmstore-blob.ts'))
    for (const file of reached) assert.doesNotMatch(srcSource(file), /@vercel\/blob/, `${file} must not reach @vercel/blob`)
  })
})

// .svelte files: kept apart from jsFiles() so the import-graph map above still lists .ts modules
// only. A component sits above render.ts and below app.ts; nothing in .ts imports one yet.
const webDir = join(root, 'web')
const svelteFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? svelteFiles(join(dir, entry.name)) : entry.name.endsWith('.svelte') ? [join(dir, entry.name)] : [],
      )
    : []
const allSvelte = () => [...svelteFiles(jsDir), ...svelteFiles(webDir)]
const scriptOf = (source: string) => [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')

const svelteRules = {
  imports: (file: string, source: string): string[] =>
    importsOf(scriptOf(source)).filter((spec) => {
      if (/graphology/.test(spec)) return true
      if (!spec.startsWith('.')) return false
      const target = join(dirname(file), spec)
      return target !== jsDir && !target.startsWith(jsDir + '/')
    }),
  innerHTML: (source: string) => /innerHTML|insertAdjacentHTML/.test(scriptOf(source)) || /`\s*<[a-zA-Z]/.test(scriptOf(source)),
  atHtml: (source: string) => /\{@html\b/.test(source),
  style: (source: string) => /<style[\s>]/.test(source) || /\sstyle\s*=\s*["'{]/.test(source),
  fontSize: (source: string) => /font-size\s*:\s*[\d.]+px/.test(source),
}

describe('svelte files follow the same rules as the .ts modules', () => {
  const fakeFile = join(jsDir, 'Fake.svelte')
  const script = (body: string) => `<script lang="ts">\n${body}\n</script>\n<p>x</p>`

  it('the scan really finds the proof component', () => {
    assert.ok(allSvelte().some((f) => f.endsWith('Proof.svelte')))
    assert.ok(allSvelte().some((f) => f.includes(join('web', 'routes'))))
  })

  it('svelte files import only from src/ui', () => {
    for (const file of allSvelte()) assert.deepEqual(svelteRules.imports(file, readFileSync(file, 'utf8')), [], `${file} must import only from src/ui`)
    assert.deepEqual(svelteRules.imports(fakeFile, script(`import { x } from '../db.js'`)), ['../db.js'])
    assert.deepEqual(svelteRules.imports(fakeFile, script(`import { x } from './format.js'`)), [])
  })

  it('svelte files never import graphology', () => {
    for (const file of allSvelte()) assert.ok(!/graphology/.test(importsOf(scriptOf(readFileSync(file, 'utf8'))).join(' ')), `${file} must not import graphology`)
    assert.deepEqual(svelteRules.imports(fakeFile, script(`import Graph from 'graphology'`)), ['graphology'])
  })

  it('svelte files have no innerHTML', () => {
    for (const file of allSvelte()) assert.equal(svelteRules.innerHTML(readFileSync(file, 'utf8')), false, `${file} must not write innerHTML`)
    assert.equal(svelteRules.innerHTML(script(`el.innerHTML = 'x'`)), true)
    assert.equal(svelteRules.innerHTML(script('const m = `<b>x</b>`')), true)
  })

  it('svelte files have no {@html}', () => {
    for (const file of allSvelte()) assert.equal(svelteRules.atHtml(readFileSync(file, 'utf8')), false, `${file} must not use {@html}`)
    assert.equal(svelteRules.atHtml('<div>{@html x}</div>'), true)
  })

  it('svelte files have no style block or style attribute', () => {
    for (const file of allSvelte()) assert.equal(svelteRules.style(readFileSync(file, 'utf8')), false, `${file} must not carry a style block or attribute`)
    assert.equal(svelteRules.style('<p>x</p>\n<style>p { color: red }</style>'), true)
    assert.equal(svelteRules.style('<p style="color: red">x</p>'), true)
    assert.equal(svelteRules.style('<p style:--w={w}>x</p>'), false)
  })

  it('svelte files use no px font-size', () => {
    for (const file of allSvelte()) assert.equal(svelteRules.fontSize(readFileSync(file, 'utf8')), false, `${file} must use the --t-* ramp`)
    assert.equal(svelteRules.fontSize('<p>font-size: 12px</p>'), true)
  })
})

describe('component test harness', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string>; devDependencies: Record<string, string> }
  const vitestConfig = readFileSync(join(root, 'vitest.config.ts'), 'utf8')

  it('pnpm test runs node --test then vitest, joined with &&', () => {
    assert.match(pkg.scripts.test, /^DATA_DIR=memory:\/\/ node .*--test test\/\*\.test\.ts && vitest run$/)
  })

  it('the two runners select disjoint files', () => {
    assert.doesNotMatch(pkg.scripts.test, /test\/components/)
    assert.match(vitestConfig, /test\/components\/\*\*\/\*\.spec\.ts/)
    assert.doesNotMatch(vitestConfig, /\.test\.ts/)
  })

  it('typecheck is one script that syncs, runs tsc and svelte-check on the svelte tsconfig', () => {
    assert.match(pkg.scripts.typecheck, /^svelte-kit sync && tsc -p tsconfig\.json && svelte-check .*--tsconfig \.\/tsconfig\.svelte\.json$/)
  })

  it('svelte-check reads a tsconfig that extends the generated one and covers web/', () => {
    const cfg = JSON.parse(readFileSync(join(root, 'tsconfig.svelte.json'), 'utf8')) as { extends: string; include: string[] }
    assert.equal(cfg.extends, './.svelte-kit/tsconfig.json')
    assert.ok(cfg.include.some((i) => i.startsWith('web/')))
    assert.ok(cfg.include.some((i) => i.startsWith('test/components')))
  })

  it('no document leaks into the node:test process', () => {
    assert.equal((globalThis as { document?: unknown }).document, undefined)
  })

  it('devDependencies vitest, happy-dom, svelte-check are exact-pinned', () => {
    for (const name of ['vitest', 'happy-dom', 'svelte-check']) assert.match(pkg.devDependencies[name], /^\d/, `${name} must be pinned exact`)
  })
})
