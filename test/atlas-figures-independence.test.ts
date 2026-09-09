import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { persons } from './fixture.js'
import { clearScopes } from '../public/js/state.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'

// Issue #92's independence criteria: each figure owns its own sentence, its own fetches and
// its own state, driven here against the real modules (public/js/app.js's boot() and each
// figure's own mount()) with a fake document and a spied fetch — never against a claim about
// them, and never by grepping design-5.html for behaviour (CLAUDE.md).

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const design5 = () => readFileSync(join(root, 'public', 'design-5.html'), 'utf8')
const moduleSource = (name: string) => readFileSync(join(root, 'public', 'js', name), 'utf8')

const people = persons.map(({ id, name }) => ({ id, name }))
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

// app.js's own self-boot ("if (typeof document !== 'undefined') boot()") only ever fires once
// per process, the first time this module is imported — and only when a document already
// exists. Importing it statically, before any test installs a fake document, keeps that guard
// false for the whole file, so every test below drives boot() itself, exactly once, on its own
// terms (criterion 12 depends on this: a stray auto-boot would double the /api/people count).
const appModule = await import('../public/js/app.js')

const withLocation = async <T>(search: string, fn: () => Promise<T> | T): Promise<T> => {
  const previous = (globalThis as { location?: unknown }).location
  ;(globalThis as { location?: unknown }).location = { search }
  try {
    return await fn()
  } finally {
    ;(globalThis as { location?: unknown }).location = previous
  }
}

describe('issue #92 AC7: the two figures can show different people at once', () => {
  it('atlas.person seeds figure 1, testimony.person seeds figure 2, independently', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/api/people': people,
        '/graph': emptyGraph(personA),
        '/sources': [],
        '/testimony': emptyTestimony,
      })
      await withLocation(`?atlas.person=${personA.id}&testimony.person=${personB.id}`, () => appModule.boot())
      await flush()
      const graphCall = calls.find((u) => u.includes('/graph'))
      const sourcesCall = calls.find((u) => u.includes('/sources'))
      const testimonyCall = calls.find((u) => u.includes('/testimony'))
      assert.ok(graphCall?.includes(`/people/${personA.id}/graph`), `figure 1 must ask about ${personA.id}: ${graphCall}`)
      assert.ok(sourcesCall?.includes(`/people/${personB.id}/sources`), `figure 2 must ask about ${personB.id}: ${sourcesCall}`)
      assert.ok(testimonyCall?.includes(`/people/${personB.id}/testimony`), `figure 2 must ask about ${personB.id}: ${testimonyCall}`)
      assert.equal(els.person.value, personA.id)
      assert.equal(els.testimonyPerson.value, personB.id)
    })
  })
})

describe('issue #92 AC8: a bare querystring key seeds both figures; a prefixed one overrides only its own', () => {
  it('bare days= seeds both figures', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeDefault(calls)
      await withLocation('?days=7', () => appModule.boot())
      await flush()
      assert.equal(els.days.value, '7')
      assert.equal(els.testimonyDays.value, '7')
    })
  })

  it('testimony.days= overrides figure 2 only, leaving figure 1 on the bare value', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeDefault(calls)
      await withLocation('?days=7&testimony.days=365', () => appModule.boot())
      await flush()
      assert.equal(els.days.value, '7', "figure 1 keeps the bare value; it has no prefixed override here")
      assert.equal(els.testimonyDays.value, '365', 'figure 2 takes its own prefixed value over the bare one')
    })
  })
})

describe('issue #92 AC9: a control change never crosses figures', () => {
  it("changing figure 2's own control reloads only figure 2", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeDefault(calls)
      await withLocation('', () => appModule.boot())
      await flush()
      const before = calls.length
      els.testimonyDays.value = '90'
      els.testimonyDays.fire('change')
      await flush(220)
      const added = calls.slice(before)
      assert.ok(added.some((u) => u.includes('/sources') || u.includes('/testimony')), 'figure 2 must reload')
      assert.ok(!added.some((u) => u.includes('/graph')), `figure 1 must not reload: ${JSON.stringify(added)}`)
    })
  })

  it("changing figure 1's own control reloads only figure 1", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeDefault(calls)
      await withLocation('', () => appModule.boot())
      await flush()
      const before = calls.length
      els.days.value = '90'
      els.days.fire('change')
      await flush(220)
      const added = calls.slice(before)
      assert.ok(added.some((u) => u.includes('/graph')), 'figure 1 must reload')
      assert.ok(!added.some((u) => u.includes('/sources') || u.includes('/testimony')), `figure 2 must not reload: ${JSON.stringify(added)}`)
    })
  })
})

describe('issue #92 AC12: /api/people is fetched exactly once, and seeds both figures', () => {
  it('one call to /api/people mounts both person selects', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeDefault(calls)
      await withLocation('', () => appModule.boot())
      await flush()
      const peopleCalls = calls.filter((u) => new URL(u, 'http://localhost').pathname === '/api/people')
      assert.equal(peopleCalls.length, 1, `boot() must fetch /api/people exactly once regardless of how many figures mount: ${JSON.stringify(calls)}`)
      assert.equal(els.person.options.length, people.length)
      assert.equal(els.testimonyPerson.options.length, people.length)
    })
  })
})

describe('issue #92 AC10/AC11: the sentence and the stats badge moved into each figure', () => {
  it('#stats no longer lives in header.top; #atlasStats lives in #workspace instead', () => {
    const html = design5()
    const header = html.match(/<header class="top">[\s\S]*?<\/header>/)?.[0] ?? ''
    assert.doesNotMatch(header, /id="stats"/, 'header.top no longer describes the whole page with a number')
    const workspace = html.match(/id="workspace"[\s\S]*?<\/section>/)?.[0] ?? ''
    const figureTitle = workspace.match(/<div class="figure-title">[\s\S]*?<\/div>/)?.[0] ?? ''
    assert.match(figureTitle, /id="atlasStats"/, '#atlasStats belongs to #workspace\'s own figure-title now')
  })

  it('there is no top-level <section class="sentence">', () => {
    assert.doesNotMatch(design5(), /<section class="sentence"/, 'the sentence moved inside each figure\'s own figure-head')
  })

  it("#workspace's figure-head carries its own sentence-line with person/days/source/sort/limit", () => {
    const workspace = design5().match(/id="workspace"[\s\S]*?<\/section>/)?.[0] ?? ''
    const head = workspace.match(/<header class="figure-head">[\s\S]*?<\/header>/)?.[0] ?? ''
    const sentence = head.match(/class="sentence-line">[\s\S]*?<\/p>/)?.[0] ?? ''
    for (const id of ['person', 'days', 'source', 'sort', 'limit']) assert.match(sentence, new RegExp(`id="${id}"`), `#${id} must sit inside #workspace's own sentence-line`)
  })

  it("#testimony's figure-head carries its own sentence-line with testimonyPerson/testimonyDays/testimonySource", () => {
    const testimony = design5().match(/id="testimony"[\s\S]*?<\/section>/)?.[0] ?? ''
    const head = testimony.match(/<header class="figure-head">[\s\S]*?<\/header>/)?.[0] ?? ''
    const sentence = head.match(/class="sentence-line">[\s\S]*?<\/p>/)?.[0] ?? ''
    for (const id of ['testimonyPerson', 'testimonyDays', 'testimonySource']) assert.match(sentence, new RegExp(`id="${id}"`), `#${id} must sit inside #testimony's own sentence-line`)
  })
})

describe('issue #92 AC13: the strip repaints off its own ResizeObserver, not figure 1\'s resizeMap', () => {
  it("figures/testimony.js observes #strip with its own ResizeObserver", () => {
    const src = moduleSource(join('figures', 'testimony.js'))
    assert.match(src, /new ResizeObserver\(/, 'figure 2 must own its own ResizeObserver')
    assert.match(src, /\.observe\(\$\('strip'\)\)/, "it must observe its own #strip")
  })

  it("figures/atlas.js's resize handling no longer reads or writes #strip, #testimonyList or #outletList", () => {
    const src = moduleSource(join('figures', 'atlas.js'))
    assert.doesNotMatch(src, /\$\('strip'\)/, 'figure 1 must not touch #strip any more')
    assert.doesNotMatch(src, /\$\('testimonyList'\)/, 'figure 1 must not touch #testimonyList any more')
    assert.doesNotMatch(src, /\$\('outletList'\)/, 'figure 1 must not touch #outletList any more')
  })
})
