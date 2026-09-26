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
const design5 = () => readFileSync(join(root, 'public', 'atlas.html'), 'utf8')

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

const risingData = (terms: RisingTerm[], about = { recent: 8, baseline: 3, words_recent: 40, words_baseline: 12 }, present: RisingTerm[] = terms): Rising => ({ days: 7, baseline: 30, terms, present, outlets: [], about })

describe('figures/rising.js is importable outside a browser, touches document only inside mount, exports exactly mount', async () => {
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

describe('risingParams stays fixed at the route\'s own defaults', () => {
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

describe("(mount): fetches /rising with the figure's own fixed recorte", () => {
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

describe('an empty terms array paints the empty note and still renders about.recent/about.baseline', () => {
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
      assert.match(els.risingAbout.textContent, /0 pares texto-palavra agora, 50 antes/, 'words_* are doc_terms rows, named as pairs, never as words')
    })
  })

  it('a payload without about.words_* says nothing about pairs instead of printing a zero', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/rising': { days: 7, baseline: 30, terms: [risingTerm({ term: 'antigo' })], outlets: [], about: { recent: 3, baseline: 12 } } })
      const { mount } = await import('../src/ui/figures/rising.js')
      mount(els.rising, { people, initial: {} })
      await flush()
      assert.match(els.risingAbout.textContent, /3 textos nos últimos 7 dias, 12 nos 30 dias antes\.$/)
      assert.doesNotMatch(els.risingAbout.textContent, /par/)
      assert.match(els.risingRuler.innerHTML, /data-term="antigo"/)
      assert.doesNotMatch(els.risingRuler.innerHTML, /NaN/)
    })
  })
})

describe('pressing Escape releases the selected word the same way a background click does', () => {
  it('closes the docs card opened by a word click', async () => {
    await withFiguresDom(async (els, calls, fireDocumentKeydown) => {
      clearScopes()
      routeFetch(calls, { '/rising': risingData([risingTerm({ term: 'diretor' })]) })
      const { mount } = await import('../src/ui/figures/rising.js')
      mount(els.rising, { people, initial: {} })
      await flush()
      const [word] = els.risingRuler.querySelectorAll('[data-term]')
      assert.ok(word, 'the ruler must render one clickable word')
      word.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true, 'picking a word must open the docs card')
      fireDocumentKeydown('Escape')
      assert.equal(els.docsDialog.open, false, 'Escape must release the selection and close the card it opened')
    })
  })
})

describe('a control change or a resize keeps the pick and the card in step', () => {
  it('a control change closes the card this figure opened', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/rising': risingData([risingTerm()]), '/docs': { docs: [], total: 0 } })
      const { mount } = await import('../src/ui/figures/rising.js')
      mount(els.rising, { people, initial: {} })
      await flush()
      const [word] = els.risingRuler.querySelectorAll('[data-term]')
      word.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      els.risingSource.value = 'gdelt'
      els.risingSource.fire('change')
      await flush(220)
      assert.equal(els.docsDialog.open, false, 'the card closes with the pick it belongs to')
    })
  })

  it('a pick here, then an atlas card over it, then a control change: the atlas card survives (ownership, not `selected`)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/rising': risingData([risingTerm()]), '/docs': { docs: [], total: 0 } })
      const docsCard = await import('../src/ui/docs-card.js')
      const { mount } = await import('../src/ui/figures/rising.js')
      mount(els.rising, { people, initial: {} })
      await flush()
      els.risingRuler.querySelectorAll('[data-term]')[0].fire('click')
      await flush()
      assert.equal(docsCard.openedBy('rising'), true)
      docsCard.open({ owner: 'atlas', kicker: 'Documentos com', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '30' }) }] })
      await flush()
      assert.equal(docsCard.openedBy('rising'), false, 'the atlas now owns the card')
      els.risingSource.value = 'gdelt'
      els.risingSource.fire('change')
      await flush(220)
      assert.equal(els.docsDialog.open, true, 'the atlas card must survive even though this figure still had a pick')
    })
  })

  it('a resize repaint keeps the pick, and clicking the same word again releases it', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const captured: { target: unknown; cb: () => void }[] = []
      ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
        cb: () => void
        constructor(cb: () => void) {
          this.cb = cb
        }
        observe(target: unknown) {
          captured.push({ target, cb: this.cb })
        }
        disconnect() {}
      }
      routeFetch(calls, { '/rising': risingData([risingTerm()]), '/docs': { docs: [], total: 0 } })
      const { mount } = await import('../src/ui/figures/rising.js')
      mount(els.rising, { people, initial: {} })
      await flush()
      const observers = captured.filter((c) => c.target === els.risingRuler)
      assert.equal(observers.length, 1)
      els.risingRuler.querySelectorAll('[data-term]')[0].fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      els.risingRuler.clientWidth = 400
      observers[0].cb()
      await flush()
      assert.equal(els.docsDialog.open, true, 'a resize must not close the card')
      assert.match(els.risingRuler.innerHTML, /is-selected/, 'the picked word stays selected across a resize repaint')
      els.risingRuler.querySelectorAll('[data-term]')[0].fire('click')
      await flush()
      assert.equal(els.docsDialog.open, false, 'clicking the same word again releases it')
    })
  })

  it('a pick made during the reload debounce closes when the new data lands', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/rising': risingData([risingTerm()]), '/docs': { docs: [], total: 0 } })
      const { mount } = await import('../src/ui/figures/rising.js')
      mount(els.rising, { people, initial: {} })
      await flush()
      routeFetch(calls, { '/rising': risingData([risingTerm()]), '/docs': { docs: [], total: 0 } })
      els.risingSource.value = 'gdelt'
      els.risingSource.fire('change')
      els.risingRuler.querySelectorAll('[data-term]')[0].fire('click')
      assert.equal(els.docsDialog.open, true, 'the stale ruler is still clickable inside the debounce')
      await flush(220)
      assert.equal(els.docsDialog.open, false, 'a card opened against the previous recorte must close with the new data')
    })
  })

  it('a pick made during the reload debounce closes when that reload fails', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/rising': risingData([risingTerm()]), '/docs': { docs: [], total: 0 } })
      const { mount } = await import('../src/ui/figures/rising.js')
      mount(els.rising, { people, initial: {} })
      await flush()
      const ok = globalThis.fetch
      globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        if (new URL(String(input), 'http://localhost').pathname.endsWith('/rising')) throw new Error('offline')
        return ok(input as RequestInfo, init)
      }) as typeof fetch
      els.risingSource.value = 'gdelt'
      els.risingSource.fire('change')
      els.risingRuler.querySelectorAll('[data-term]')[0].fire('click')
      assert.equal(els.docsDialog.open, true)
      await flush(220)
      assert.equal(els.docsDialog.open, false, 'the card must not survive over the error note')
    })
  })
})

describe('a GET /rising failure paints the ruler error note and never leaves the loading ghost on screen', () => {
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

describe('atlas.html carries the fourth figure card', () => {
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
