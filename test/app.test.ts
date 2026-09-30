import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { persons } from './fixture.js'
import { docsText } from './docs.js'
import { clearScopes } from '../src/ui/state.js'
import { bootData } from '../src/ui/boot.svelte.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'

// src/ui/app.ts, the shell: boot() fetches /api/people once, seeds each figure from the
// querystring and hands a failure down to every figure. Issue #92's independence criteria are
// driven against the real modules (boot() and each figure's own mount()) with a fake document
// and a spied fetch — never against a claim about them.

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

// A dead API and an empty seed.json are different facts, and the page must not report one as
// the other. master's boot() reached an error branch with its own copy and a retry button;
// after the split the shell fetches /api/people once, so the failure has to travel down into
// every figure's mount() or both figures would silently claim nobody is tracked.
const withLocationAndReload = async <T>(search: string, fn: (reloads: number[]) => Promise<T> | T): Promise<T> => {
  const previous = (globalThis as { location?: unknown }).location
  const reloads: number[] = []
  ;(globalThis as { location?: unknown }).location = { search, reload: () => reloads.push(1) }
  try {
    return await fn(reloads)
  } finally {
    ;(globalThis as { location?: unknown }).location = previous
  }
}

describe('a failed GET /api/people is an outage, never an empty seed', () => {
  it('paints the error copy and a working retry in figure 4, not the empty-seed copy', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        calls.push(String(input))
        throw new Error('network down')
      }) as typeof fetch
      await withLocationAndReload('', async () => {
        await appModule.boot()
        await flush()

        // Figure 4 has no retry of its own: same outage copy in #risingAbout, ruler hidden.
        assert.equal(els.risingAbout.textContent, 'Falha de rede ou base indisponível.')
        assert.equal(els.risingRuler.hidden, true)
      })
    })
  })
})

describe('the loading ghost shows before /api/people resolves', () => {
  it('boot() paints the loading reader synchronously, ahead of the network round trip', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        calls.push(String(input))
        return new Promise(() => {}) as unknown as Response
      }) as typeof fetch
      await withLocation('', async () => {
        const booting = appModule.boot()
        assert.equal(els.risingRuler.hidden, false, 'issue #151: figure 4 gets its own boot ghost too')
        assert.match(els.risingRuler.innerHTML, /ruler-axis/)
        void booting
      })
    })
  })
})

describe('figure 4 (rising) joins app.ts\'s bootstrap, same bare/prefixed convention as the other three', () => {
  it('bare ?person= seeds risingPerson; rising.source overrides the source for figure 4 only', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': people, '/graph': emptyGraph(personA), '/sources': [], '/testimony': emptyTestimony })
      await withLocation(`?person=${personB.id}&rising.source=gdelt`, () => appModule.boot())
      await flush()
      assert.equal(els.risingPerson.value, personB.id, 'the bare person key seeds figure 4 too, same fallback figure 1/2 read')
      const risingCall = calls.find((u) => u.includes('/rising'))
      assert.ok(risingCall?.includes(`/people/${personB.id}/rising`), `figure 4 must ask about ${personB.id}: ${risingCall}`)
      assert.match(risingCall!, /source=gdelt/)
    })
  })
})

describe('figure 6 (lenses) has no bare a=/b= fallback, unlike figure 3\'s a', () => {
  it('a bare a= never seeds lensesA; lenses.b= still seeds lensesB', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/api/people': people,
        '/graph': emptyGraph(personA),
        '/sources': [],
        '/testimony': emptyTestimony,
        '/lenses': { days: 30, a: { lens: 'all', about: 0 }, b: { lens: 'lean:right', about: 0 }, terms: [] },
      })
      await withLocation('?a=lean:left&lenses.b=lean:right', () => appModule.boot())
      await flush()
      const lensesCall = calls.find((u) => u.includes('/lenses'))
      assert.ok(lensesCall, 'figure 6 must have requested /lenses')
      const qs = new URL(lensesCall!, 'http://localhost').searchParams
      assert.equal(qs.get('a'), 'all', 'a bare a= must never leak into the lenses figure (keys: [\'a\', null])')
      assert.equal(qs.get('b'), 'lean:right', 'lenses.b= (prefixed) must still seed it')
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
