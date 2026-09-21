import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearScopes } from '../src/ui/state.js'
import { weekParams } from '../src/ui/api.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import './close.js'
import type { Week, WeekBucket } from '../src/ui/format.js'

// src/ui/figures/week.ts, figure 5 (issue #147): its own mount(), the fixed days=7 request
// builder, and the empty/error/loading branches painted through #weekChart and #weekNote.
// paintWeek/paintWeekLoading/paintWeekError are exercised directly (as pure painters) in
// test/render.test.ts, and weekLayout in test/layout.test.ts; picking a word and opening
// #docsDialog with a day is exercised here since it is this figure's own contract.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const design5 = () => readFileSync(join(root, 'public', 'design-5.html'), 'utf8')

const personA = { id: 'lula', name: 'Lula' }
const personB = { id: 'bolsonaro', name: 'Bolsonaro' }
const people = [personA, personB]

const bucket = (over: Partial<WeekBucket> = {}): WeekBucket => ({ start: '2026-09-08T03:00:00.000Z', about: 5, terms: [{ term: 'reforma', kind: 'word', count: 3 }], ...over })

const weekData = (buckets: WeekBucket[]): Week => ({ days: 7, tz: 'America/Sao_Paulo', buckets })

describe('figures/week.js is importable outside a browser, touches document only inside mount, exports exactly mount', async () => {
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document defined at import time')
  const mod = await import('../src/ui/figures/week.js')
  it('does not touch document at import time', () => {
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/week.js must not touch document')
  })
  it('exports exactly mount', () => {
    assert.deepEqual(Object.keys(mod), ['mount'])
    assert.equal(typeof mod.mount, 'function')
  })
})

describe('weekParams stays fixed at days=7', () => {
  it('sends days=7, the full kind set, plus the chosen source and limit', () => {
    const qp = weekParams({ source: 'gdelt', limit: '5' })
    assert.equal(qp.get('days'), '7')
    assert.equal(qp.get('kind'), 'word,hashtag,phrase')
    assert.equal(qp.get('source'), 'gdelt')
    assert.equal(qp.get('limit'), '5')
  })
})

describe('(mount): fetches /week with the figure own fixed recorte', () => {
  it('requests days=7 plus the selected person, source and limit', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/week': weekData([bucket()]) })
      const { mount } = await import('../src/ui/figures/week.js')
      mount(els.week, { people, initial: { person: 'bolsonaro', source: 'gdelt', limit: '5' } })
      await flush()
      const url = calls.find((u) => u.includes('/week'))
      assert.ok(url, 'must have requested /week')
      assert.match(url!, /\/api\/people\/bolsonaro\/week\?/)
      const qs = new URL(url!, 'http://localhost').searchParams
      assert.equal(qs.get('days'), '7')
      assert.equal(qs.get('source'), 'gdelt')
      assert.equal(qs.get('limit'), '5')
    })
  })

  it('paints the chart on success and shows the word from the fixture', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/week': weekData([bucket({ terms: [{ term: 'reforma', kind: 'word', count: 4 }] })]) })
      const { mount } = await import('../src/ui/figures/week.js')
      mount(els.week, { people, initial: {} })
      await flush()
      assert.equal(els.weekChart.hidden, false)
      assert.match(els.weekChart.innerHTML, /data-term="reforma"/)
      assert.match(els.weekChart.innerHTML, /data-kind="word"/)
    })
  })
})

describe('picking a word in a column opens the docs card with that column own day', () => {
  it('sends day=<column BRT date> plus days=7, the term, kind and source to /docs; releasing closes the card', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/week': weekData([bucket({ start: '2026-09-08T03:00:00.000Z', terms: [{ term: 'reforma', kind: 'word', count: 4 }] })]) })
      const { mount } = await import('../src/ui/figures/week.js')
      mount(els.week, { people, initial: { person: 'lula', source: 'gdelt' } })
      await flush()
      const mark = [...els.weekChart.querySelectorAll('[data-term]')].find((el: any) => el.dataset.term === 'reforma')
      assert.ok(mark, 'the word must be reachable by its data-term stub')
      mark.fire('click')
      await flush()
      const docsUrl = calls.find((u) => u.includes('/docs'))
      assert.ok(docsUrl, 'picking a word must request /docs')
      const qs = new URL(docsUrl!, 'http://localhost').searchParams
      assert.equal(qs.get('day'), '2026-09-08')
      assert.equal(qs.get('days'), '7')
      assert.equal(qs.get('term'), 'reforma')
      assert.equal(qs.get('kind'), 'word')
      assert.equal(qs.get('source'), 'gdelt')
      assert.equal(els.docsDialog.open, true)
      mark.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, false, 'clicking the same word again releases the pick and closes the card')
    })
  })

  it('the card kicker names the calendar day, so its count never contradicts the atlas silently (#148 review, 3)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/week': weekData([bucket({ start: '2026-09-08T03:00:00.000Z', terms: [{ term: 'reforma', kind: 'word', count: 4 }] })]) })
      const { mount } = await import('../src/ui/figures/week.js')
      mount(els.week, { people, initial: { person: 'lula' } })
      await flush()
      const mark = [...els.weekChart.querySelectorAll('[data-term]')].find((el: any) => el.dataset.term === 'reforma')
      mark!.fire('click')
      await flush()
      assert.match(String(els.docsKicker.textContent), /palavra/)
      assert.match(String(els.docsKicker.textContent), /ter\.? 8/, 'the kicker carries the weekday and day of month of the column')
    })
  })

  it('a control change on this figure never closes a card another figure opened (#148 review, 2)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/week': weekData([bucket()]), '/docs': { docs: [], total: 0 } })
      const docsCard = await import('../src/ui/docs-card.js')
      const { mount } = await import('../src/ui/figures/week.js')
      mount(els.week, { people, initial: { person: 'lula' } })
      await flush()
      docsCard.open({ kicker: 'Documentos com', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '30' }) }] })
      await flush()
      assert.equal(els.docsDialog.open, true)
      els.weekLimit.value = '5'
      els.weekLimit.fire('change')
      await flush(220)
      assert.equal(els.docsDialog.open, true, 'the atlas card must survive a change on #weekLimit')
    })
  })

  it('a control change closes the card this figure opened', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/week': weekData([bucket()]), '/docs': { docs: [], total: 0 } })
      const { mount } = await import('../src/ui/figures/week.js')
      mount(els.week, { people, initial: { person: 'lula' } })
      await flush()
      const mark = [...els.weekChart.querySelectorAll('[data-term]')].find((el: any) => el.dataset.term === 'reforma')
      mark!.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      els.weekLimit.value = '5'
      els.weekLimit.fire('change')
      await flush(220)
      assert.equal(els.docsDialog.open, false, 'the week card closes with the pick it belongs to')
    })
  })

  it('a week pick, then an atlas card over it, then #weekLimit: the atlas card survives (ownership, not `selected`)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/week': weekData([bucket()]), '/docs': { docs: [], total: 0 } })
      const docsCard = await import('../src/ui/docs-card.js')
      const { mount } = await import('../src/ui/figures/week.js')
      mount(els.week, { people, initial: { person: 'lula' } })
      await flush()
      const mark = [...els.weekChart.querySelectorAll('[data-term]')].find((el: any) => el.dataset.term === 'reforma')
      mark!.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true, 'the week card is open')
      assert.equal(docsCard.openedBy('week'), true)
      docsCard.open({ owner: 'atlas', kicker: 'Documentos com', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '30' }) }] })
      await flush()
      assert.equal(docsCard.openedBy('week'), false, 'the atlas now owns the card')
      els.weekLimit.value = '5'
      els.weekLimit.fire('change')
      await flush(220)
      assert.equal(els.docsDialog.open, true, 'the atlas card must survive even though this figure still had a pick')
      els.weekChart.fire('click', { target: { closest: () => null } })
      await flush()
      assert.equal(els.docsDialog.open, true, 'a background click here releases nothing it does not own')
    })
  })
})

describe('an empty week keeps the seven about numbers and paints no marks', () => {
  it('#weekChart shows no data-term marks and #weekNote states there are not enough words', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const buckets = Array.from({ length: 7 }, (_, i) => bucket({ start: `2026-09-0${i + 2}T03:00:00.000Z`, about: i + 1, terms: [] }))
      routeFetch(calls, { '/week': weekData(buckets) })
      const { mount } = await import('../src/ui/figures/week.js')
      mount(els.week, { people, initial: {} })
      await flush()
      assert.equal(els.weekChart.querySelectorAll('[data-term]').length, 0, 'no invented marks')
      for (let i = 1; i <= 7; i++) assert.match(els.weekChart.innerHTML, new RegExp(`<dd>${i}</dd>`), `about=${i} must survive`)
      assert.match(els.weekNote.textContent, /Não há palavras suficientes/)
    })
  })
})

describe('a GET /week failure paints the chart error note and never leaves the loading ghost on screen', () => {
  it('rejects the request; the ghost is replaced by the error note', async () => {
    await withFiguresDom(async (els) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        void input
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
      }) as typeof fetch
      const { mount } = await import('../src/ui/figures/week.js')
      mount(els.week, { people, initial: {} })
      await flush()
      assert.match(els.weekChart.innerHTML, /Não foi possível carregar a semana/)
      assert.doesNotMatch(els.weekChart.innerHTML, /ghost-field/, 'the loading ghost must not survive a failed request')
    })
  })
})

describe('an outage in /api/people travels down as peopleError, same as the other figures', () => {
  it('paints a network-failure note instead of an empty-registry one', async () => {
    await withFiguresDom(async (els) => {
      clearScopes()
      const { mount } = await import('../src/ui/figures/week.js')
      mount(els.week, { people: [], initial: {}, peopleError: new Error('boom') })
      await flush()
      assert.match(els.weekNote.textContent, /Falha de rede ou base indisponível\./)
    })
  })
})

describe('design-5.html carries the fifth figure card', () => {
  it('a <section class="figure week ..." id="week"> exists after #rising, with eyebrow "Gráfico 5" and only person/source/limit in its sentence', () => {
    const html = design5()
    const risingIdx = html.indexOf('id="rising"')
    const weekIdx = html.indexOf('id="week"')
    assert.ok(risingIdx !== -1 && weekIdx !== -1)
    assert.ok(risingIdx < weekIdx, '#week must come after #rising')
    assert.match(html, /<section class="figure[^"]*" id="week"/)
    assert.match(html, /<span class="eyebrow">Gráfico 5<\/span>/)
    const week = html.match(/id="week"[\s\S]*?<\/section>/)?.[0] ?? ''
    const sentence = week.match(/class="sentence-line">[\s\S]*?<\/p>/)?.[0] ?? ''
    for (const id of ['weekPerson', 'weekSource', 'weekLimit']) assert.match(sentence, new RegExp(`id="${id}"`), `#${id} must live in the week's own sentence`)
    assert.doesNotMatch(sentence, /id="weekDays"/, '#weekDays must not exist: days stays fixed at 7, never a control')
  })
})
