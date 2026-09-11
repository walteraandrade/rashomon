import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { persons } from './fixture.js'
import { clearScopes } from '../src/ui/state.js'
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

// app.js's own self-boot ("if (typeof document !== 'undefined') boot()") only ever fires once
// per process, the first time this module is imported — and only when a document already
// exists. Importing it statically, before any test installs a fake document, keeps that guard
// false for the whole file, so every test below drives boot() itself, exactly once, on its own
// terms (criterion 12 depends on this: a stray auto-boot would double the /api/people count).
const appModule = await import('../src/ui/app.js')

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

  it('bare source= seeds both figures', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
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
      routeDefault(calls)
      await withLocation('?days=30&atlas.days=7', () => appModule.boot())
      await flush()
      assert.equal(els.days.value, '7', "figure 1 takes its own prefixed override")
      assert.equal(els.testimonyDays.value, '30', 'figure 2 keeps the bare value')
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
      els.testimonyDays.value = '365'
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
      els.days.value = '365'
      els.days.fire('change')
      await flush(220)
      const added = calls.slice(before)
      assert.ok(added.some((u) => u.includes('/graph')), 'figure 1 must reload')
      assert.ok(!added.some((u) => u.includes('/sources') || u.includes('/testimony')), `figure 2 must not reload: ${JSON.stringify(added)}`)
    })
  })

  it("changing figure 1's source control reloads only figure 1", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
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

describe('issue #92: a failed GET /api/people is an outage, never an empty seed', () => {
  it('paints the error copy and a working retry in both figures, not the empty-seed copy', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        calls.push(String(input))
        throw new Error('network down')
      }) as typeof fetch
      await withLocationAndReload('', async (reloads) => {
        await appModule.boot()
        await flush()

        assert.equal(els.status.textContent, 'Não foi possível carregar dados reais.')
        assert.equal(els.status.classes.error, true, 'the status badge must carry the .error class')
        assert.match(els.viewport.innerHTML, /Falha de rede ou base indispon[ií]vel/)
        assert.match(els.viewport.innerHTML, /Nenhum gr[aá]fico fict[ií]cio ser[aá] exibido|Nenhum grafo fict[ií]cio ser[aá] exibido/)
        assert.match(els.viewport.innerHTML, /id="retry"/, 'the retry button must be emitted, not just resolvable')
        assert.doesNotMatch(els.viewport.innerHTML, /seed\.json/, 'an outage must never claim the seed is empty')
        assert.notEqual(els.status.textContent, 'Nenhuma pessoa cadastrada.')

        assert.match(els.testimonyList.innerHTML, /Falha de rede ou base indispon[ií]vel/)
        assert.match(els.testimonyList.innerHTML, /id="testimonyRetry"/)
        assert.notEqual(els.testimonyList.textContent, 'Nenhuma pessoa cadastrada.')

        els.retry.fire('click')
        els.testimonyRetry.fire('click')
        assert.equal(reloads.length, 2, 'both retry buttons must be wired to a real re-fetch')
      })
    })
  })

  it('an empty people list still reads as an empty seed, not as an outage', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': [] })
      await withLocation('', () => appModule.boot())
      await flush()
      assert.equal(els.status.textContent, 'Nenhuma pessoa cadastrada.')
      assert.match(els.viewport.innerHTML, /seed\.json/)
      assert.doesNotMatch(els.viewport.innerHTML, /Falha de rede/)
    })
  })
})

describe('issue #92: the loading ghost shows before /api/people resolves', () => {
  it('boot() paints the loading reader synchronously, ahead of the network round trip', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        calls.push(String(input))
        return new Promise(() => {}) as unknown as Response
      }) as typeof fetch
      await withLocation('', async () => {
        const booting = appModule.boot()
        assert.equal(els.status.textContent, 'Lendo as pessoas.', 'a cold start must not show bare static markup')
        assert.match(els.viewport.innerHTML, /ghost-field/)
        assert.match(els.viewport.innerHTML, /class="ghost"/)
        assert.match(els.testimonyList.innerHTML, /Lendo a avaliação/)
        assert.equal(els.strip.hidden, false)
        assert.match(els.compareRuler.innerHTML, /Lendo a régua/)
        void booting
      })
    })
  })
})
