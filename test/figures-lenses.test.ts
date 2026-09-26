import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearScopes } from '../src/ui/state.js'
import { SOURCES } from '../src/query.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import './close.js'
import type { CompareTerm, Lenses } from '../src/ui/format.js'

// src/ui/figures/lenses.ts, figure 6 (issue #206): its own mount(), the two independently-
// scoped lens selects, the ruler paints (paintLensRuler/paintLensDetail/paintLensesLoading are
// exercised directly in test/render.test.ts), and the two-sided docs-card wiring.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const design5 = () => readFileSync(join(root, 'public', 'atlas.html'), 'utf8')

const personA = { id: 'lula', name: 'Lula' }
const personB = { id: 'bolsonaro', name: 'Bolsonaro' }
const people = [personA, personB]

const lensesData = (terms: CompareTerm[], a = 'all', b = 'lean:right'): Lenses => ({
  days: 30,
  a: { lens: a, about: 5 },
  b: { lens: b, about: 5 },
  terms,
})

describe('figures/lenses.js is importable outside a browser, touches document only inside mount, exports exactly mount', async () => {
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document defined at import time')
  const mod = await import('../src/ui/figures/lenses.js')
  it('does not touch document at import time', () => {
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/lenses.js must not touch document')
  })
  it('exports exactly mount', () => {
    assert.deepEqual(Object.keys(mod), ['mount'])
    assert.equal(typeof mod.mount, 'function')
  })
})

describe('(mount): fetches /lenses with the selected person, a, b, days and limit', () => {
  it('requests /api/people/:id/lenses with the current control values', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/lenses': lensesData([]) })
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people, initial: { person: 'bolsonaro' } })
      await flush()
      const url = calls.find((u) => u.includes('/lenses'))
      assert.ok(url, 'must have requested /lenses')
      assert.match(url!, /\/api\/people\/bolsonaro\/lenses\?/)
      const qs = new URL(url!, 'http://localhost').searchParams
      assert.equal(qs.get('a'), 'all')
      assert.equal(qs.get('b'), 'all')
      assert.equal(qs.get('days'), '30')
      assert.equal(qs.get('limit'), '40', "the API default is 40, not the static markup's 20")
      assert.equal(qs.get('kind'), 'word,hashtag,phrase')
    })
  })
})

describe('changing a lens control triggers exactly one new /lenses call with the new params', () => {
  it('changing lensesA sends the new a= on the next request', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/lenses': lensesData([]) })
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people, initial: {} })
      await flush()
      const before = calls.length
      els.lensesA.value = 'lean:left'
      els.lensesA.fire('change')
      await flush(220)
      const added = calls.slice(before).filter((u) => u.includes('/lenses'))
      assert.equal(added.length, 1)
      const qs = new URL(added[0], 'http://localhost').searchParams
      assert.equal(qs.get('a'), 'lean:left')
    })
  })

  it('changing lensesDays and lensesLimit each send the new value', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/lenses': lensesData([]) })
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people, initial: {} })
      await flush()
      let before = calls.length
      els.lensesDays.value = '365'
      els.lensesDays.fire('change')
      await flush(220)
      let qs = new URL(calls.slice(before).find((u) => u.includes('/lenses'))!, 'http://localhost').searchParams
      assert.equal(qs.get('days'), '365')
      clearScopes()
      before = calls.length
      els.lensesLimit.value = '100'
      els.lensesLimit.fire('change')
      await flush(220)
      qs = new URL(calls.slice(before).find((u) => u.includes('/lenses'))!, 'http://localhost').searchParams
      assert.equal(qs.get('limit'), '100')
    })
  })
})

describe('a seeded domain lens survives loadOutlets\' own optgroup fill (validator gap #2)', () => {
  it('applies the pending a= seed after /sources fills the Veículo optgroup, and sends it on the /lenses request', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/lenses': lensesData([]),
        '/sources': [{ domain: 'folha.uol.com.br', docs: 12 }, { domain: 'g1.globo.com', docs: 4 }],
      })
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people, initial: { a: 'domain:folha.uol.com.br' } })
      await flush()
      assert.equal(els.lensesA.value, 'domain:folha.uol.com.br', 'the seed must survive the optgroup fill')
      const url = calls.find((u) => u.includes('/lenses'))
      const qs = new URL(url!, 'http://localhost').searchParams
      assert.equal(qs.get('a'), 'domain:folha.uol.com.br')
    })
  })
})

describe('changing the tracked person keeps the previous domain only if the new person has it (validator gap #3)', () => {
  it('drops the previous domain, falling back to all, when the new person\'s outlets do not have it', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/lenses': lensesData([]), '/sources': [{ domain: 'folha.uol.com.br', docs: 12 }] })
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people, initial: { a: 'domain:folha.uol.com.br' } })
      await flush()
      assert.equal(els.lensesA.value, 'domain:folha.uol.com.br')
      routeFetch(calls, { '/lenses': lensesData([]), '/sources': [{ domain: 'g1.globo.com', docs: 4 }] })
      const before = calls.length
      els.lensesPerson.value = 'bolsonaro'
      els.lensesPerson.fire('change')
      await flush(220)
      assert.equal(els.lensesA.value, 'all', "folha.uol.com.br isn't among bolsonaro's own outlets")
      const url = calls.slice(before).find((u) => u.includes('/lenses'))
      const qs = new URL(url!, 'http://localhost').searchParams
      assert.equal(qs.get('a'), 'all', 'the request must carry the same value the select shows, never a stale domain')
    })
  })

  it("keeps the previous domain when the new person's own outlets still have it", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/lenses': lensesData([]), '/sources': [{ domain: 'folha.uol.com.br', docs: 12 }] })
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people, initial: { a: 'domain:folha.uol.com.br' } })
      await flush()
      routeFetch(calls, { '/lenses': lensesData([]), '/sources': [{ domain: 'folha.uol.com.br', docs: 7 }] })
      const before = calls.length
      els.lensesPerson.value = 'bolsonaro'
      els.lensesPerson.fire('change')
      await flush(220)
      assert.equal(els.lensesA.value, 'domain:folha.uol.com.br')
      const url = calls.slice(before).find((u) => u.includes('/lenses'))
      const qs = new URL(url!, 'http://localhost').searchParams
      assert.equal(qs.get('a'), 'domain:folha.uol.com.br')
    })
  })
})

describe('changing lensesDays re-fetches /sources too, since its own window changed (validator gap #3)', () => {
  it('requests /sources again after a lensesDays change', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/lenses': lensesData([]), '/sources': [{ domain: 'folha.uol.com.br', docs: 12 }] })
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people, initial: {} })
      await flush()
      const before = calls.length
      els.lensesDays.value = '365'
      els.lensesDays.fire('change')
      await flush(220)
      const sourcesCalls = calls.slice(before).filter((u) => u.includes('/sources'))
      assert.ok(sourcesCalls.length >= 1, 'a days change must re-fetch /sources, which the outlet optgroup is scoped by')
    })
  })
})

describe('#lensesStatus becomes visible only when a.lens === b.lens on the response', () => {
  it('shows the same-recorte notice when both sides resolve to the same lens', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/lenses': lensesData([], 'all', 'all') })
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people, initial: {} })
      await flush()
      assert.equal(els.lensesStatus.hidden, false)
    })
  })

  it('stays hidden when the two lenses differ', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/lenses': lensesData([], 'all', 'lean:right') })
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people, initial: {} })
      await flush()
      assert.equal(els.lensesStatus.hidden, true)
    })
  })
})

describe('an empty terms list paints the shared empty-state note', () => {
  it('#lensesRuler shows "Nenhuma palavra neste recorte."', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/lenses': lensesData([]) })
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people, initial: {} })
      await flush()
      assert.match(els.lensesRuler.innerHTML, /Nenhuma palavra neste recorte\./)
    })
  })
})

describe('clicking a word opens the docs card with two sides, one per lens', () => {
  it('each side carries the right domain/lean/source filter for its own lens', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const terms: CompareTerm[] = [{ term: 'reforma', kind: 'word', a: { count: 5, pmi: 1.2, tone: null }, b: { count: 2, pmi: 0.4, tone: null } }]
      routeFetch(calls, { '/lenses': lensesData(terms, 'domain:folha.uol.com.br', 'lean:right') })
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people: [personA], initial: {} })
      await flush()
      const [word] = els.lensesRuler.querySelectorAll('[data-term]')
      assert.ok(word, 'the ruler must render one clickable word')
      word.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      const docsUrls = calls.filter((u) => u.includes('/docs'))
      assert.equal(docsUrls.length, 2, 'one /docs request per lens')
      const params = docsUrls.map((u) => new URL(u, 'http://localhost').searchParams)
      assert.ok(params.some((p) => p.get('domain') === 'folha.uol.com.br'), 'side a must carry its own domain filter')
      assert.ok(params.some((p) => p.get('lean') === 'right'), 'side b must carry its own lean filter')
    })
  })

  it('clicking the same word again releases the selection and closes the card', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const terms: CompareTerm[] = [{ term: 'reforma', kind: 'word', a: { count: 5, pmi: 1.2, tone: null }, b: null }]
      routeFetch(calls, { '/lenses': lensesData(terms) })
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people: [personA], initial: {} })
      await flush()
      let word = els.lensesRuler.querySelectorAll('[data-term]')[0]
      word.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      word = els.lensesRuler.querySelectorAll('[data-term]')[0]
      word.fire('click')
      assert.equal(els.docsDialog.open, false)
    })
  })
})

describe('a GET /lenses failure paints the ruler error note and never leaves the loading ghost on screen', () => {
  it('rejects the request; the ghost is replaced by the error note', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        calls.push(String(input))
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
      }) as typeof fetch
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people, initial: {} })
      await flush()
      assert.match(els.lensesRuler.innerHTML, /Não foi possível carregar as lentes/)
      assert.doesNotMatch(els.lensesRuler.innerHTML, /ghost-field/, 'the loading ghost must not survive a failed request')
    })
  })
})

describe('an outage in /api/people travels down as peopleError, same as every other figure', () => {
  it('paints a network-failure note instead of an empty-registry one', async () => {
    await withFiguresDom(async (els) => {
      clearScopes()
      const { mount } = await import('../src/ui/figures/lenses.js')
      mount(els.lenses, { people: [], initial: {}, peopleError: new Error('boom') })
      await flush()
      assert.match(els.lensesDetail.innerHTML, /Falha de rede ou base indisponível\./)
    })
  })
})

describe('atlas.html carries the sixth figure card', () => {
  it('a <section class="figure ..." id="lenses"> exists after #week, with eyebrow "Gráfico 6"', () => {
    const html = design5()
    const weekIdx = html.indexOf('id="week"')
    const lensesIdx = html.indexOf('id="lenses"')
    assert.ok(weekIdx !== -1 && lensesIdx !== -1)
    assert.ok(weekIdx < lensesIdx, '#lenses must come after #week')
    assert.match(html, /<section class="figure[^"]*" id="lenses"/)
    assert.match(html, /<span class="eyebrow">Gráfico 6<\/span>/)
  })

  it("the Fonte optgroups' options match query.ts's SOURCES exactly (no local copy left to drift)", () => {
    const html = design5()
    const lenses = html.match(/id="lenses"[\s\S]*?<\/section>/)?.[0] ?? ''
    const fonteGroups = [...lenses.matchAll(/<optgroup label="Fonte">([\s\S]*?)<\/optgroup>/g)]
    assert.ok(fonteGroups.length >= 2, 'both #lensesA and #lensesB must carry a Fonte optgroup')
    for (const [, body] of fonteGroups) {
      const values = [...body.matchAll(/<option value="source:([^"]+)">/g)].map(([, v]) => v)
      assert.deepEqual(values, SOURCES, 'the Fonte optgroup must offer exactly SOURCES, in order')
    }
  })
})
