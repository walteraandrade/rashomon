import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { persons } from './fixture.js'
import { docsText } from './docs.js'
import { pageMarkup } from './pages.js'
import { clearScopes } from '../src/ui/state.js'
import { bootData } from '../src/ui/boot.svelte.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'

// src/ui/app.ts, the shell: boot() fetches /api/people once, seeds each figure from the
// querystring and hands a failure down to every figure. Issue #92's independence criteria are
// driven against the real modules (boot() and each figure's own mount()) with a fake document
// and a spied fetch — never against a claim about them.

const people = persons.map(({ id, name }) => ({ id, name }))
const [personA] = people

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

// Importing app.ts never boots: web/routes/+page.svelte calls boot() from onMount, and every
// test below drives boot() itself, exactly once, on its own terms (a stray boot would double
// the /api/people count).
const appModule = await import('../src/ui/app.js')

describe('importing app does not boot', () => {
  it('a fresh import with a document present requests nothing and mounts no figure', async () => {
    await withFiguresDom(async (_els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': people, '/graph': emptyGraph(personA), '/sources': [], '/testimony': emptyTestimony })
      const fresh = await import(`../src/ui/app.js?fresh=${Date.now()}`)
      await flush()
      assert.equal(typeof fresh.boot, 'function')
      assert.deepEqual(calls, [], 'importing app.ts must not fetch: boot() is called explicitly')
    })
  })
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

describe('/api/people is fetched exactly once, and seeds every figure', () => {
  it('one call to /api/people serves every figure', async () => {
    await withFiguresDom(async (_els, calls) => {
      clearScopes()
      routeDefault(calls)
      await withLocation('', () => appModule.boot())
      await flush()
      const peopleCalls = calls.filter((u) => new URL(u, 'http://localhost').pathname === '/api/people')
      assert.equal(peopleCalls.length, 1, `boot() must fetch /api/people exactly once regardless of how many figures mount: ${JSON.stringify(calls)}`)
    })
  })
})

describe('figure 10 querystring keys are documented (issue #215)', () => {
  it('names the persistence figure id, person and limit bare or prefixed, and weeks prefixed only', () => {
    assert.match(docsText, /persistence\.weeks/)
    assert.match(docsText, /persistence[\s\S]{0,600}\bperson\b[\s\S]{0,120}\blimit\b[\s\S]{0,200}(bare|prefixed)/i)
    assert.match(docsText, /persistence[\s\S]{0,800}\bweeks\b[\s\S]{0,250}(prefixed only|no bare|only (the )?prefixed|never (a )?bare)/i)
  })
})

describe('boot() publishes bootData once /api/people settles', () => {
  it('a successful fetch sets ready, people and search', async () => {
    await withFiguresDom(async (_els, calls) => {
      clearScopes()
      routeDefault(calls)
      await withLocation('?days=7', () => appModule.boot())
      await flush()
      assert.equal(bootData.ready, true)
      assert.deepEqual(bootData.people, people)
      assert.equal(bootData.peopleError, null)
      assert.equal(bootData.search, '?days=7')
    })
  })

  it('a failed fetch still sets ready, with peopleError', async () => {
    await withFiguresDom(async (_els, calls) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        calls.push(String(input))
        throw new Error('network down')
      }) as typeof fetch
      await withLocation('', () => appModule.boot())
      await flush()
      assert.equal(bootData.ready, true)
      assert.deepEqual(bootData.people, [])
      assert.ok(bootData.peopleError)
    })
  })
})

describe('figure 9 is a Svelte component', () => {
  it('documents that comention is a Svelte component seeded from days, source, lean and min, sharing the single /api/people fetch (AC16)', () => {
    assert.match(docsText, /comention[\s\S]{0,300}Svelte component/i)
    assert.match(docsText, /Comention\.svelte/)
    assert.match(docsText, /comention[\s\S]{0,600}\bdays\b[\s\S]{0,120}\bsource\b[\s\S]{0,200}\blean\b[\s\S]{0,120}\bmin\b/i)
    assert.match(docsText, /comention[\s\S]{0,1200}\/api\/people[\s\S]{0,200}(once|single|shared|one fetch)/i)
  })
})

describe('figure 4 is a Svelte component (#292)', () => {
  it('documents that rising is a Svelte component seeded from bootData with person and source, and no longer a figures/*.ts mount', () => {
    assert.match(docsText, /Rising\.svelte/)
    assert.match(docsText, /rising[\s\S]{0,300}Svelte component/i)
    assert.match(docsText, /rising[\s\S]{0,600}\bperson\b[\s\S]{0,120}\bsource\b/i)
    assert.doesNotMatch(docsText, /figures\/rising/)
  })

  it('the prerendered page carries every figure 4 hook, after figure 3, with only person and source as controls', () => {
    const page = pageMarkup('/')
    for (const id of ['rising', 'risingTitle', 'risingPerson', 'risingSource', 'risingRuler', 'risingAbout']) assert.match(page, new RegExp(`id="${id}"`), `#${id} must be in the page`)
    assert.ok(page.indexOf('id="compare"') >= 0, '#compare must be in the page')
    assert.ok(page.indexOf('id="compare"') < page.indexOf('id="rising"'), '#rising must come after #compare')
    assert.match(page, /<section class="figure[^"]*" id="rising"/)
    const section = page.slice(page.indexOf('id="rising"'))
    const line = section.match(/<[^>]*class="[^"]*sentence-line[^"]*"[\s\S]*?<\/(?:p|div)>/)?.[0] ?? section.slice(0, 2500)
    for (const id of ['risingDays', 'risingBaseline', 'risingKind', 'risingLimit', 'risingMin']) assert.doesNotMatch(line, new RegExp(`id="${id}"`), `#${id} is not a control`)
  })
})
