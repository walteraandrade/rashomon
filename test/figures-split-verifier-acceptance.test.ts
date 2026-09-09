import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { persons } from './fixture.js'
import { clearScopes } from '../public/js/state.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'

// Independent verification of issue #92's acceptance criteria, written from the approved spec
// rather than from public/js/figures/*.js or the tests the builder committed alongside it
// (test/atlas-figures-independence.test.ts and friends). Where those already drive the real
// mount() against a spied fetch, this file re-derives the same facts with fresh scenarios
// (different people, different controls, an actual resize callback for AC13) so a bug that
// happened to make the builder's own assertions pass would not also make these pass.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const jsDir = join(root, 'public', 'js')
const design5 = () => readFileSync(join(root, 'public', 'design-5.html'), 'utf8')
const moduleSource = (name: string) => readFileSync(join(jsDir, name), 'utf8')
const jsFiles = (dir = jsDir, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? jsFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : entry.name.endsWith('.js') ? [`${prefix}${entry.name}`] : [],
  )
const importsOf = (source: string) => [...source.matchAll(/(?:^|\n)(?:import\b|export\s*\{)[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

const people = persons.slice(0, 2).map(({ id, name }) => ({ id, name }))
const [personA, personB] = people

const emptyGraph = (person: { id: string; name: string }) => ({
  person,
  nodes: [],
  links: [],
  stats: { about: 0, testimony: { method: 'kikori', score: null, n: 0 } },
})
const emptyTestimony = { method: 'kikori', overall: { score: null, n: 0 }, by_source: [], by_domain: [] }

const routeDefault = (calls: string[]) =>
  routeFetch(calls, {
    '/api/people': people,
    '/graph': emptyGraph(personA),
    '/sources': [],
    '/testimony': emptyTestimony,
  })

const withLocation = async <T>(search: string, fn: () => Promise<T> | T): Promise<T> => {
  const previous = (globalThis as { location?: unknown }).location
  ;(globalThis as { location?: unknown }).location = { search }
  try {
    return await fn()
  } finally {
    ;(globalThis as { location?: unknown }).location = previous
  }
}

describe('AC1: both figure modules are importable outside a browser with no document side effect', async () => {
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document defined at import time')
  const atlas = await import('../public/js/figures/atlas.js')
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/atlas.js touched document')
  const testimony = await import('../public/js/figures/testimony.js')
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/testimony.js touched document')

  it('figures/atlas.js exports a mount function', () => {
    assert.equal(typeof atlas.mount, 'function')
  })
  it('figures/testimony.js exports a mount function', () => {
    assert.equal(typeof testimony.mount, 'function')
  })
})

describe('AC2: the import graph walks public/js/figures/ and matches the spec exactly', () => {
  it('every file in public/js/figures/ is visible to the recursive walk', () => {
    assert.ok(jsFiles().includes('figures/atlas.js'))
    assert.ok(jsFiles().includes('figures/testimony.js'))
  })

  it('the declared import list of every module matches the spec, acyclically', () => {
    const expected: Record<string, string[]> = {
      'format.js': [],
      'state.js': [],
      'api.js': [],
      'layout.js': ['./format.js'],
      'render.js': ['./format.js', './layout.js'],
      'figures/atlas.js': ['./api.js', './format.js', './layout.js', './render.js', './state.js'],
      'figures/testimony.js': ['./api.js', './format.js', './render.js', './state.js'],
      'app.js': ['./figures/atlas.js', './figures/testimony.js'],
    }
    assert.deepEqual(jsFiles().sort(), Object.keys(expected).sort())
    for (const [file, allowed] of Object.entries(expected)) {
      const resolved = importsOf(moduleSource(file)).map((spec) => (file.includes('/') && spec.startsWith('../') ? `.${spec.slice(2)}` : spec))
      assert.deepEqual(resolved.sort(), [...allowed].sort(), `${file} imports ${JSON.stringify(resolved)}, spec says ${JSON.stringify(allowed)}`)
    }
  })
})

describe('AC3: app.js is a shell exporting only boot', async () => {
  const app = await import('../public/js/app.js')
  it('boot is the sole export', () => {
    assert.deepEqual(Object.keys(app), ['boot'])
    assert.equal(typeof app.boot, 'function')
  })
})

describe('AC4: state.js and figures/testimony.js drop per-figure state, keep the shared memo', async () => {
  const state = await import('../public/js/state.js')
  const testimony = await import('../public/js/figures/testimony.js')

  it('state.js still carries fromScope and debounce alongside the scope memo', () => {
    for (const name of ['readScope', 'writeScope', 'clearScopes', 'SCOPE_TTL_MS', 'SCOPE_LIMIT', 'fromScope', 'debounce'])
      assert.equal(name in state, true, `state.js must still export ${name}`)
  })

  it('state.js does not carry per-figure state', () => {
    for (const name of ['outlet', 'zoom', 'layoutCache', 'mask', 'getController', 'setController'])
      assert.equal(name in state, false, `state.js must not export ${name}: it is figure-private now`)
  })

  it('figures/testimony.js exposes exactly mount, no outlet/zoom/mask/request-id helper', () => {
    assert.deepEqual(Object.keys(testimony), ['mount'])
  })
})

describe('AC5: the two acceptance suites this issue touches import from the new module paths', () => {
  it('atlas-request-reuse-acceptance.test.ts imports createHandlers/docsQuery/scopeKeys from figures/atlas.js and fromScope/debounce from state.js', () => {
    const src = readFileSync(join(root, 'test', 'atlas-request-reuse-acceptance.test.ts'), 'utf8')
    const atlasImport = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/public\/js\/figures\/atlas\.js['"]/)
    assert.ok(atlasImport, 'must import from ../public/js/figures/atlas.js')
    for (const name of ['createHandlers', 'docsQuery', 'scopeKeys']) assert.match(atlasImport![1], new RegExp(`\\b${name}\\b`))
    const stateImport = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/public\/js\/state\.js['"]/)
    assert.ok(stateImport, 'must import from ../public/js/state.js')
    for (const name of ['fromScope', 'debounce']) assert.match(stateImport![1], new RegExp(`\\b${name}\\b`))
  })

  it('unified-atlas-acceptance.test.ts imports createHandlers from figures/atlas.js', () => {
    const src = readFileSync(join(root, 'test', 'unified-atlas-acceptance.test.ts'), 'utf8')
    assert.match(src, /from ['"]\.\.\/public\/js\/figures\/atlas\.js['"]/)
  })
})

describe('AC6: figures/atlas.js drops resetOutlet; figures/testimony.js releases its own outlet locally', async () => {
  it('createHandlers accepts no resetOutlet action, and control("person") never mentions an outlet', async () => {
    const { createHandlers } = await import('../public/js/figures/atlas.js')
    const src = moduleSource(join('figures', 'atlas.js'))
    const signature = src.match(/export const createHandlers = \(\{([\s\S]*?)\}\) => \(\{/)?.[1] ?? ''
    assert.doesNotMatch(signature, /\bresetOutlet\b/, "createHandlers' action parameter list must not declare resetOutlet any more (a comment may still mention it as documentation)")
    const calls: string[] = []
    const handlers = createHandlers({
      updateHeader: () => calls.push('updateHeader'),
      load: () => calls.push('load'),
    })
    handlers.control('person')()
    assert.deepEqual(calls, ['updateHeader', 'load'], 'control(person) only updates the header and reloads; nothing outlet-related runs')
  })

  it("changing testimony's own person, days or source releases its own focused outlet, via a real mount()", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const { mount } = await import('../public/js/figures/testimony.js')
      routeFetch(calls, {
        '/sources': [{ domain: 'g1.globo.com', source: 'gnews', docs: 5 }],
        '/testimony': { method: 'kikori', overall: { score: null, n: 0 }, by_source: [], by_domain: [] },
      })
      mount(els.testimony, { people, initial: { person: personA.id } })
      await flush()
      const [button] = els.outletList.querySelectorAll('[data-domain]')
      assert.ok(button, 'the mocked /sources row must render one clickable outlet')
      button.fire('click')
      assert.notEqual(els.domainLabel.textContent, '', 'picking an outlet focuses it')
      els.testimonySource.value = 'gnews'
      els.testimonySource.fire('change')
      await flush(200)
      assert.equal(els.domainLabel.textContent, '', "changing this figure's own source control released the outlet")
    })
  })
})

describe('AC7: the two figures can show different people at once (fresh people order from AC7 in atlas-figures-independence.test.ts)', () => {
  it('atlas.person=B and testimony.person=A produce two different requests', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const appModule = await import('../public/js/app.js')
      routeFetch(calls, { '/api/people': people, '/graph': emptyGraph(personB), '/sources': [], '/testimony': emptyTestimony })
      await withLocation(`?atlas.person=${personB.id}&testimony.person=${personA.id}`, () => appModule.boot())
      await flush()
      const graphCall = calls.find((u) => u.includes('/graph'))
      const sourcesCall = calls.find((u) => u.includes('/sources'))
      assert.ok(graphCall?.includes(`/people/${personB.id}/graph`), `figure 1 must ask about ${personB.id}: ${graphCall}`)
      assert.ok(sourcesCall?.includes(`/people/${personA.id}/sources`), `figure 2 must ask about ${personA.id}: ${sourcesCall}`)
      assert.equal(els.person.value, personB.id)
      assert.equal(els.testimonyPerson.value, personA.id)
    })
  })
})

describe('AC8: a bare key seeds both figures; a prefixed atlas.days overrides figure 1 only', () => {
  it('bare source= seeds both figures', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const appModule = await import('../public/js/app.js')
      routeDefault(calls)
      await withLocation('?source=gnews', () => appModule.boot())
      await flush()
      assert.equal(els.source.value, 'gnews')
      assert.equal(els.testimonySource.value, 'gnews')
    })
  })

  it('atlas.days overrides figure 1 only, leaving figure 2 on the bare value', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const appModule = await import('../public/js/app.js')
      routeDefault(calls)
      await withLocation('?days=30&atlas.days=7', () => appModule.boot())
      await flush()
      assert.equal(els.days.value, '7', "figure 1 takes its own prefixed override")
      assert.equal(els.testimonyDays.value, '30', 'figure 2 keeps the bare value')
    })
  })
})

describe('AC9: control changes never cross figures (source control, not days)', () => {
  it("changing figure 1's source control reloads only figure 1", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const appModule = await import('../public/js/app.js')
      routeDefault(calls)
      await withLocation('', () => appModule.boot())
      await flush()
      const before = calls.length
      els.source.value = 'gnews'
      els.source.fire('change')
      await flush(220)
      const added = calls.slice(before)
      assert.ok(added.some((u) => u.includes('/graph')), 'figure 1 must reload')
      assert.ok(!added.some((u) => u.includes('/sources') || u.includes('/testimony')), `figure 2 must not reload: ${JSON.stringify(added)}`)
    })
  })

  it("changing figure 2's source control reloads only figure 2", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const appModule = await import('../public/js/app.js')
      routeDefault(calls)
      await withLocation('', () => appModule.boot())
      await flush()
      const before = calls.length
      els.testimonySource.value = 'gnews'
      els.testimonySource.fire('change')
      await flush(220)
      const added = calls.slice(before)
      assert.ok(added.some((u) => u.includes('/sources') || u.includes('/testimony')), 'figure 2 must reload')
      assert.ok(!added.some((u) => u.includes('/graph')), `figure 1 must not reload: ${JSON.stringify(added)}`)
    })
  })
})

describe('AC12: GET /api/people is fetched exactly once regardless of how many figures mount', () => {
  it('one call feeds both person selects with the same people', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const appModule = await import('../public/js/app.js')
      routeDefault(calls)
      await withLocation('', () => appModule.boot())
      await flush()
      const peopleCalls = calls.filter((u) => new URL(u, 'http://localhost').pathname === '/api/people')
      assert.equal(peopleCalls.length, 1, `expected exactly one /api/people call, got: ${JSON.stringify(calls)}`)
      const atlasNames = els.person.options.map((o) => o.textContent)
      const testimonyNames = els.testimonyPerson.options.map((o) => o.textContent)
      assert.deepEqual(atlasNames, testimonyNames, 'both selects must be built from the same one people list')
    })
  })
})

describe('AC10/AC11: the sentence and the stats badge live inside each figure, not page-wide', () => {
  it('#stats is gone from header.top; #atlasStats sits in #workspace', () => {
    const html = design5()
    const header = html.match(/<header class="top">[\s\S]*?<\/header>/)?.[0] ?? ''
    assert.doesNotMatch(header, /id="stats"/)
    const workspace = html.match(/id="workspace"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(workspace, /id="atlasStats"/)
  })

  it('there is no top-level <section class="sentence"> any more', () => {
    assert.doesNotMatch(design5(), /<section class="sentence"/)
  })

  it('exactly two .sentence-line elements exist, one inside each figure-head', () => {
    const html = design5()
    const matches = [...html.matchAll(/class="sentence-line"/g)]
    assert.equal(matches.length, 2, 'one sentence-line per figure, no page-wide one left over')
    const workspace = html.match(/id="workspace"[\s\S]*?<\/section>/)?.[0] ?? ''
    const testimony = html.match(/id="testimony"[\s\S]*?<\/section>/)?.[0] ?? ''
    for (const id of ['person', 'days', 'source', 'sort', 'limit']) assert.match(workspace, new RegExp(`id="${id}"`), `#workspace must contain #${id}`)
    for (const id of ['testimonyPerson', 'testimonyDays', 'testimonySource']) assert.match(testimony, new RegExp(`id="${id}"`), `#testimony must contain #${id}`)
    assert.doesNotMatch(testimony, /id="sort"|id="limit"/, 'figure 2 has no sort/limit control')
  })
})

describe('AC13: the strip repaints off its own ResizeObserver in figures/testimony.js, never through figures/atlas.js', () => {
  it("figures/atlas.js's source never mentions #strip, #testimonyList or #outletList", () => {
    const src = moduleSource(join('figures', 'atlas.js'))
    for (const id of ['strip', 'testimonyList', 'outletList']) assert.doesNotMatch(src, new RegExp(`\\$\\('${id}'\\)`), `figure 1 must not touch #${id}`)
  })

  it('resizing #strip through the real ResizeObserver callback repaints the strip with the new width', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      // Capture the callback figures/testimony.js registers on #strip so the test can invoke a
      // resize directly, rather than trusting a claim that a ResizeObserver was constructed.
      const captured: { target: unknown; cb: () => void }[] = []
      class CapturingResizeObserver {
        cb: () => void
        constructor(cb: () => void) {
          this.cb = cb
        }
        observe(target: unknown) {
          captured.push({ target, cb: this.cb })
        }
        disconnect() {}
      }
      ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = CapturingResizeObserver
      const { mount } = await import('../public/js/figures/testimony.js')
      routeFetch(calls, {
        '/sources': [],
        '/testimony': { method: 'kikori', overall: { score: 1.5, n: 8 }, by_source: [], by_domain: [{ domain: 'g1.globo.com', source: 'gnews', score: 1.5, n: 8 }] },
      })
      els.strip.clientWidth = 800
      mount(els.testimony, { people, initial: { person: personA.id } })
      await flush()
      const firstMarkup = els.strip.innerHTML
      assert.match(firstMarkup, /viewBox="0 0 800/, 'the strip must first paint at its own clientWidth')
      const stripObserver = captured.find((c) => c.target === els.strip)
      assert.ok(stripObserver, 'figures/testimony.js must observe #strip with its own ResizeObserver')
      els.strip.clientWidth = 400
      stripObserver!.cb()
      const secondMarkup = els.strip.innerHTML
      assert.notEqual(secondMarkup, firstMarkup, 'firing the ResizeObserver callback must repaint the strip')
      assert.match(secondMarkup, /viewBox="0 0 400/, 'the repaint must use the new width')
    })
  })
})

describe('AC14: design-5.html keeps no <style> block, no inline style= beyond --var, one module script', () => {
  it('markup shape after the split', () => {
    const html = design5()
    assert.doesNotMatch(html, /<style[\s>]/i)
    const inlineStyles = [...html.matchAll(/\bstyle="([^"]*)"/g)].map((m) => m[1])
    for (const value of inlineStyles) assert.ok(value.trim().startsWith('--'), `inline style="${value}" is not a --var override`)
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    const moduleScripts = scripts.filter(([, attrs]) => /\btype="module"/.test(attrs))
    assert.equal(moduleScripts.length, 1)
    assert.match(moduleScripts[0][0], /src="\.\/bundle\.js"/)
  })
})
