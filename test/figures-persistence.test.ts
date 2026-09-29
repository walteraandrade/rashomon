import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { brtDate } from '../src/query.js'
import { clearScopes } from '../src/ui/state.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import './close.js'

// src/ui/figures/persistence.ts, figure 10 (issue #215): its own mount(), the request it builds,
// the click and release through the shared docs card, and the ghost, error and peopleError
// wiring. Painting, layout and seeding are pinned in render.test.ts, layout.test.ts and
// app.test.ts.

const shift = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const mondayOf = (date: string) => shift(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7))
const cur = mondayOf(brtDate(new Date()))
const prev = shift(cur, -7)

const MONTHS = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.']
const spanLabel = (monday: string) => {
  const sunday = shift(monday, 6)
  const [, m1, d1] = monday.split('-').map(Number)
  const [, m2, d2] = sunday.split('-').map(Number)
  return m1 === m2 ? `de ${d1} a ${d2} de ${MONTHS[m1 - 1]}` : `de ${d1} de ${MONTHS[m1 - 1]} a ${d2} de ${MONTHS[m2 - 1]}`
}

const HORIZON = 45
const series = (counts: (number | null)[]) => counts.map((count, i) => ({ week: shift(cur, -7 * (counts.length - 1 - i)), count }))
const payload = (over: Record<string, unknown> = {}) => ({
  weeks: 12,
  since: '2026-09-09',
  first_week: shift(cur, -70),
  horizon: HORIZON,
  terms: [{ term: 'anistia', kind: 'word', series: series([null, null, null, null, null, null, 2, 3, 3, 5, 4, 6]), streak: 6, half_life: null }],
  ...over,
})

const people = [
  { id: 'lula', name: 'Lula' },
  { id: 'bolsonaro', name: 'Bolsonaro' },
]

const cellFor = (els: { persistenceChart: { querySelectorAll: (s: string) => any[] } }, week: string) =>
  els.persistenceChart.querySelectorAll('[data-week]').find((el: any) => el.dataset.week === week)

describe('figures/persistence.js is importable outside a browser and exports exactly mount', async () => {
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document defined at import time')
  const mod = await import('../src/ui/figures/persistence.js')
  it('exports exactly mount', () => {
    assert.deepEqual(Object.keys(mod), ['mount'])
    assert.equal(typeof mod.mount, 'function')
  })
})

describe('(mount): fetches /persistence with the figure own recorte', () => {
  it('requests the seeded person with weeks and limit, and no source, kind, days or min (AC19)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/persistence': payload() })
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: { person: 'bolsonaro', weeks: '26', limit: '20' } })
      await flush()
      const url = calls.find((u) => u.includes('/persistence'))
      assert.ok(url, 'must have requested /persistence')
      assert.match(url!, /\/api\/people\/bolsonaro\/persistence\?/)
      const qs = new URL(url!, 'http://localhost').searchParams
      assert.equal(qs.get('weeks'), '26')
      assert.equal(qs.get('limit'), '20')
      for (const key of ['source', 'kind', 'days', 'min', 'domain', 'lean']) assert.equal(qs.has(key), false, `${key} must not be sent`)
    })
  })

  it('with no seed it asks for the first person, 12 weeks and 40 words (AC19)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/persistence': payload() })
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: {} })
      await flush()
      const url = calls.find((u) => u.includes('/persistence'))!
      assert.match(url, /\/api\/people\/lula\/persistence\?/)
      const qs = new URL(url, 'http://localhost').searchParams
      assert.equal(qs.get('weeks'), '12')
      assert.equal(qs.get('limit'), '40')
    })
  })

  it('paints the row on success: the word and a button per filled week', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/persistence': payload() })
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: {} })
      await flush()
      assert.equal(els.persistenceChart.hidden, false)
      assert.match(els.persistenceChart.innerHTML, /anistia/)
      assert.equal(els.persistenceChart.querySelectorAll('[data-week]').length, 6)
    })
  })
})

describe('clicking a filled cell opens the docs card with that week (AC19)', () => {
  it('sends week=<Monday>, days=<horizon from the payload>, term and kind to /docs for the one tracked person; a second click closes it', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/persistence': payload(), '/docs': { docs: [], total: 0 } })
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: { person: 'lula' } })
      await flush()
      const cell = cellFor(els, prev)
      assert.ok(cell, 'the previous week has a count, so its cell is a button')
      cell.fire('click')
      await flush()
      const docs = calls.filter((u) => u.includes('/docs'))
      assert.equal(docs.length, 1, 'one side, one /docs request')
      assert.match(docs[0], /\/api\/people\/lula\/docs\?/)
      const qs = new URL(docs[0], 'http://localhost').searchParams
      assert.equal(qs.get('week'), prev)
      assert.equal(qs.get('days'), String(HORIZON))
      assert.equal(qs.get('term'), 'anistia')
      assert.equal(qs.get('kind'), 'word')
      assert.equal(els.docsDialog.open, true)
      cellFor(els, prev)!.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, false, 'clicking the same cell again releases it and closes the card')
    })
  })

  it('the kicker names the Monday-to-Sunday span in pt-BR, month abbreviated after each day only where the month changes', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const counts = Array.from({ length: 26 }, () => 3)
      routeFetch(calls, {
        '/persistence': payload({ weeks: 26, horizon: 400, first_week: shift(cur, -175), terms: [{ term: 'anistia', kind: 'word', series: series(counts), streak: 26, half_life: null }] }),
        '/docs': { docs: [], total: 0 },
      })
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: { person: 'lula', weeks: '26' } })
      await flush()
      let crossings = 0
      for (let back = 1; back <= 25; back++) {
        const monday = shift(cur, -7 * back)
        cellFor(els, monday)!.fire('click')
        await flush()
        const text = String(els.docsKicker.textContent)
        assert.ok(text.includes(spanLabel(monday)), `the kicker must name "${spanLabel(monday)}", got "${text}"`)
        if ((spanLabel(monday).match(/ de /g) ?? []).length === 2) crossings++
        cellFor(els, monday)!.fire('click')
        await flush()
      }
      assert.ok(crossings > 0, 'sanity: 25 consecutive weeks cross at least one month boundary')
    })
  })

  it('a click on empty space in the figure releases the pick and closes the card', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/persistence': payload(), '/docs': { docs: [], total: 0 } })
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: { person: 'lula' } })
      await flush()
      cellFor(els, prev)!.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      els.persistenceChart.fire('click', { target: { closest: () => null } })
      await flush()
      assert.equal(els.docsDialog.open, false)
    })
  })

  it('pressing Escape releases the pick and closes the card this figure opened', async () => {
    await withFiguresDom(async (els, calls, fireDocumentKeydown) => {
      clearScopes()
      routeFetch(calls, { '/persistence': payload(), '/docs': { docs: [], total: 0 } })
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: { person: 'lula' } })
      await flush()
      cellFor(els, prev)!.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      fireDocumentKeydown('Escape')
      await flush()
      assert.equal(els.docsDialog.open, false)
    })
  })

  it('the card is owned by persistence: a control change closes it, but never a card another figure opened', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/persistence': payload(), '/docs': { docs: [], total: 0 } })
      const docsCard = await import('../src/ui/docs-card.js')
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: { person: 'lula' } })
      await flush()
      cellFor(els, prev)!.fire('click')
      await flush()
      assert.equal(docsCard.openedBy('persistence'), true)
      els.persistenceLimit.value = '20'
      els.persistenceLimit.fire('change')
      await flush(220)
      assert.equal(els.docsDialog.open, false, 'a control change closes the card this figure opened')
      docsCard.open({ owner: 'atlas', kicker: 'Documentos com', title: 'golpe', sides: [{ personId: 'lula', personName: 'Lula', label: 'Lula', query: new URLSearchParams({ days: '30' }) }] })
      await flush()
      els.persistenceWeeks.value = '4'
      els.persistenceWeeks.fire('change')
      await flush(220)
      assert.equal(els.docsDialog.open, true, 'a card another figure owns survives a change here')
    })
  })

  it('a cell older than the horizon is filled but not a button, so it cannot open the card', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const old = shift(cur, -77)
      routeFetch(calls, { '/persistence': payload({ terms: [{ term: 'anistia', kind: 'word', series: series([3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), streak: 12, half_life: null }] }) })
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: {} })
      await flush()
      assert.equal(cellFor(els, old), undefined, 'a week 11 Mondays back is beyond a 45-day horizon')
      assert.ok(cellFor(els, prev), 'the recent weeks stay buttons')
      assert.match(els.persistenceChart.innerHTML, /data-expired="1"/)
    })
  })
})

describe('a control change refetches with the new value', () => {
  it('weeks and limit changes are sent on the next /persistence request', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/persistence': payload() })
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: {} })
      await flush()
      els.persistenceWeeks.value = '4'
      els.persistenceWeeks.fire('change')
      els.persistenceLimit.value = '60'
      els.persistenceLimit.fire('change')
      await flush(260)
      const last = new URL(calls.filter((u) => u.includes('/persistence')).at(-1)!, 'http://localhost').searchParams
      assert.equal(last.get('weeks'), '4')
      assert.equal(last.get('limit'), '60')
    })
  })
})

describe('the empty and the short series say so, never a blank figure (AC19)', () => {
  const noteFor = async (data: unknown) =>
    withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/persistence': data })
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: {} })
      await flush()
      return String(els.persistenceNote.textContent)
    })

  it('first_week null paints the empty-series note', async () => {
    const note = await noteFor(payload({ first_week: null, terms: [] }))
    assert.match(note, /Ainda sem série: a primeira semana é gravada na próxima atualização\./)
  })

  it('first_week equal to the current Monday reads "1 semana de série" (singular)', async () => {
    const note = await noteFor(payload({ first_week: cur, terms: [{ term: 'anistia', kind: 'word', series: series([null, null, null, null, null, null, null, null, null, null, null, 3]), streak: 1, half_life: null }] }))
    assert.match(note, /^1 semana de série; a leitura começa a valer com quatro\./)
  })

  it('first_week two Mondays before the current one reads "3 semanas de série"', async () => {
    const note = await noteFor(payload({ first_week: shift(cur, -14), terms: [{ term: 'anistia', kind: 'word', series: series([null, null, null, null, null, null, null, null, null, 2, 3, 3]), streak: 3, half_life: null }] }))
    assert.match(note, /^3 semanas de série; a leitura começa a valer com quatro\./)
  })

  it('four weeks of series shows no note', async () => {
    const note = await noteFor(payload({ first_week: shift(cur, -21) }))
    assert.doesNotMatch(note, /semanas? de série/)
    assert.doesNotMatch(note, /Ainda sem série/)
  })
})

describe('the loading ghost and the error note', () => {
  it('a request in flight paints a ghost with no "Carregando" word', async () => {
    await withFiguresDom(async (els) => {
      clearScopes()
      globalThis.fetch = (() => new Promise(() => {})) as typeof fetch
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: {} })
      await flush()
      assert.match(els.persistenceChart.innerHTML, /ghost-field/)
      assert.doesNotMatch(els.persistenceChart.innerHTML, /Carregando/)
    })
  })

  it('a failed request paints the error note and never leaves the ghost on screen', async () => {
    await withFiguresDom(async (els) => {
      clearScopes()
      globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response) as typeof fetch
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people, initial: {} })
      await flush()
      assert.match(els.persistenceChart.innerHTML, /Não foi possível/)
      assert.doesNotMatch(els.persistenceChart.innerHTML, /ghost-field/)
    })
  })
})

describe('an outage in /api/people travels down as peopleError, same as the other figures', () => {
  it('paints a network-failure note in #persistenceNote instead of an empty-registry one', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const { mount } = await import('../src/ui/figures/persistence.js')
      mount(els.persistence, { people: [], initial: {}, peopleError: new Error('boom') })
      await flush()
      assert.match(els.persistenceNote.textContent, /Falha de rede ou base indisponível\./)
      assert.equal(calls.filter((u) => u.includes('/persistence')).length, 0, 'no request without people')
    })
  })
})
