import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearScopes } from '../src/ui/state.js'
import { risingParams } from '../src/ui/api.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import './close.js'
import type { Rising, RisingTerm } from '../src/ui/format.js'

// src/ui/figures/rising.ts, figure 4 (issue #151): its own mount(), fixed-parameter request
// builder, and the empty/error/loading branches painted through #risingRuler and #risingAbout.
// risingRulerItems/liftOfPerson and paintRisingRuler/paintRisingRulerError/paintRisingLoading
// are exercised directly (as pure exports and painters) in test/render.test.ts; picking a word
// and opening #docsDialog is exercised in test/docs-card.test.ts, alongside the other figures.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const design5 = () => readFileSync(join(root, 'public', 'design-5.html'), 'utf8')

const personA = { id: 'lula', name: 'Lula' }
const personB = { id: 'bolsonaro', name: 'Bolsonaro' }
const people = [personA, personB]

const risingTerm = (over: Partial<RisingTerm> = {}): RisingTerm => ({
  term: 'diretor',
  kind: 'word',
  count_recent: 1.71,
  count_baseline: 0.03,
  count_recent_raw: 12,
  count_baseline_raw: 1,
  lift: 57,
  ...over,
})

const risingData = (terms: RisingTerm[], about = { recent: 8, baseline: 3, words_recent: 40, words_baseline: 12 }, rare: RisingTerm[] = []): Rising => ({ days: 7, baseline: 30, terms, rare, outlets: [], about })

describe('AC1: figures/rising.js is importable outside a browser, touches document only inside mount, exports exactly mount', async () => {
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document defined at import time')
  const mod = await import('../src/ui/figures/rising.js')
  it('does not touch document at import time', () => {
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/rising.js must not touch document')
  })
  it('exports exactly mount', () => {
    assert.deepEqual(Object.keys(mod), ['mount'])
    assert.equal(typeof mod.mount, 'function')
  })
})

describe('issue #151 §4: risingParams stays fixed at the route\'s own defaults', () => {
  it('sends days=7, baseline=30, kind=word,hashtag,phrase, limit=40, min=3, plus the chosen source', () => {
    const qp = risingParams({ source: 'gdelt' })
    assert.equal(qp.get('days'), '7')
    assert.equal(qp.get('baseline'), '30')
    assert.equal(qp.get('kind'), 'word,hashtag,phrase')
    assert.equal(qp.get('limit'), '40')
    assert.equal(qp.get('min'), '3')
    assert.equal(qp.get('source'), 'gdelt')
  })
})

describe("issue #151 AC10 (mount): fetches /rising with the figure's own fixed recorte", () => {
  it('requests the fixed days/baseline/kind/limit/min plus the selected person and source', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/rising': risingData([risingTerm()]) })
      const { mount } = await import('../src/ui/figures/rising.js')
      mount(els.rising, { people, initial: { person: 'bolsonaro', source: 'gdelt' } })
      await flush()
      const url = calls.find((u) => u.includes('/rising'))
      assert.ok(url, 'must have requested /rising')
      assert.match(url!, /\/api\/people\/bolsonaro\/rising\?/)
      const qs = new URL(url!, 'http://localhost').searchParams
      assert.equal(qs.get('days'), '7')
      assert.equal(qs.get('baseline'), '30')
      assert.equal(qs.get('kind'), 'word,hashtag,phrase')
      assert.equal(qs.get('limit'), '40')
      assert.equal(qs.get('min'), '3')
      assert.equal(qs.get('source'), 'gdelt')
    })
  })

  it('paints the ruler on success and shows the exact word from the fixture', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/rising': risingData([risingTerm({ term: 'diretor' })]) })
      const { mount } = await import('../src/ui/figures/rising.js')
      mount(els.rising, { people, initial: {} })
      await flush()
      assert.equal(els.risingRuler.hidden, false)
      assert.match(els.risingRuler.innerHTML, /data-term="diretor"/)
    })
  })
})

describe('issue #151 AC13: an empty terms array paints the empty note and still renders about.recent/about.baseline', () => {
  it('#risingRuler shows "Nenhuma palavra neste recorte." and #risingAbout names both window totals', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/rising': risingData([], { recent: 0, baseline: 12, words_recent: 0, words_baseline: 50 }) })
      const { mount } = await import('../src/ui/figures/rising.js')
      mount(els.rising, { people, initial: {} })
      await flush()
      assert.match(els.risingRuler.innerHTML, /Nenhuma palavra neste recorte\./)
      assert.match(els.risingAbout.textContent, /\b0\b/)
      assert.match(els.risingAbout.textContent, /\b12\b/)
    })
  })
})

describe('issue #151 AC14: a GET /rising failure paints the ruler error note and never leaves the loading ghost on screen', () => {
  it('rejects the request; the ghost is replaced by the error note', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        calls.push(String(input))
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
      }) as typeof fetch
      const { mount } = await import('../src/ui/figures/rising.js')
      mount(els.rising, { people, initial: {} })
      await flush()
      assert.match(els.risingRuler.innerHTML, /Não foi possível carregar os termos em alta/)
      assert.doesNotMatch(els.risingRuler.innerHTML, /ghost-field/, 'the loading ghost must not survive a failed request')
    })
  })
})

describe('an outage in /api/people travels down as peopleError, same as the other three figures', () => {
  it('paints a network-failure note instead of an empty-registry one', async () => {
    await withFiguresDom(async (els) => {
      clearScopes()
      const { mount } = await import('../src/ui/figures/rising.js')
      mount(els.rising, { people: [], initial: {}, peopleError: new Error('boom') })
      await flush()
      assert.match(els.risingAbout.textContent, /Falha de rede ou base indisponível\./)
    })
  })
})

describe('design-5.html carries the fourth figure card', () => {
  it('a <section class="figure rising ..." id="rising"> exists after #compare, with eyebrow "Gráfico 4" and only person/source in its sentence', () => {
    const html = design5()
    const compareIdx = html.indexOf('id="compare"')
    const risingIdx = html.indexOf('id="rising"')
    assert.ok(compareIdx !== -1 && risingIdx !== -1)
    assert.ok(compareIdx < risingIdx, '#rising must come after #compare')
    assert.match(html, /<section class="figure[^"]*" id="rising"/)
    assert.match(html, /<span class="eyebrow">Gráfico 4<\/span>/)
    const rising = html.match(/id="rising"[\s\S]*?<\/section>/)?.[0] ?? ''
    const sentence = rising.match(/class="sentence-line">[\s\S]*?<\/p>/)?.[0] ?? ''
    for (const id of ['risingPerson', 'risingSource']) assert.match(sentence, new RegExp(`id="${id}"`), `#${id} must live in the ruler's own sentence`)
    for (const id of ['risingDays', 'risingBaseline', 'risingKind', 'risingLimit', 'risingMin']) assert.doesNotMatch(sentence, new RegExp(`id="${id}"`), `#${id} must not exist: days/baseline/kind/limit/min stay fixed, never a control`)
  })
})
