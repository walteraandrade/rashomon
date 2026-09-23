import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { inlineStyles, withFakeDocument } from './fake-dom.js'
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
const design5 = () => readFileSync(join(root, 'public', 'design-5.html'), 'utf8')
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

describe('public/ serves every file it ships and nothing under src/ui', () => {
  it('every file left in public/ answers 200 by name', async () => {
    for (const entry of readdirSync(join(root, 'public'), { withFileTypes: true })) {
      if (entry.isDirectory()) continue
      const res = await app.request(`/${entry.name}`)
      assert.equal(res.status, 200, `public/${entry.name} is shipped but not reachable`)
    }
  })

  it('no TypeScript source under src/ui is reachable at /js/<file>: only the built bundle is served', async () => {
    for (const file of jsFiles()) assert.equal((await app.request(`/js/${file}`)).status, 404, `/js/${file} must not be served`)
  })
})

describe('design-5.html carries no styles and no logic of its own', () => {
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
      'format.ts': [],
      'state.ts': ['./perf.js'],
      'perf.ts': [],
      'api.ts': ['./perf.js'],
      'layout.ts': ['./format.js'],
      // The SVG frame/axis/overflow-list builders render.ts once hand-wrote per figure live in
      // their own DOM-free module, imported only by render.ts.
      'marks.ts': ['./format.js'],
      'render.ts': ['./format.js', './layout.js', './marks.js'],
      // The documents card and the in-page guide belong to no figure; both sit next to the
      // figures and are mounted by app.ts. help.ts has no imports: it only opens #helpDialog.
      'docs-card.ts': ['./api.js', './perf.js', './render.js', './state.js'],
      'help.ts': [],
      'figures/atlas.ts': ['./api.js', './docs-card.js', './format.js', './layout.js', './perf.js', './render.js', './state.js'],
      'figures/testimony.ts': ['./api.js', './docs-card.js', './format.js', './perf.js', './render.js', './state.js'],
      'figures/compare.ts': ['./api.js', './docs-card.js', './format.js', './perf.js', './render.js', './state.js'],
      // Figure 4, the rising ruler: same shape as figures/compare.ts, imported by nothing but
      // app.ts, and reaching into no other figure's DOM.
      'figures/rising.ts': ['./api.js', './docs-card.js', './format.js', './perf.js', './render.js', './state.js'],
      // Figure 5, the week: same shape again, imported by nothing but app.ts.
      'figures/week.ts': ['./api.js', './docs-card.js', './format.js', './layout.js', './perf.js', './render.js', './state.js'],
      'app.ts': ['./api.js', './docs-card.js', './figures/atlas.js', './figures/compare.js', './figures/rising.js', './figures/testimony.js', './figures/week.js', './help.js', './render.js'],
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

  it('only invariants.test.ts, bundle-freshness.test.ts and docs-drift.test.ts read src/ui source text', () => {
    const allowed = new Set(['invariants.test.ts', 'bundle-freshness.test.ts', 'docs-drift.test.ts'])
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
