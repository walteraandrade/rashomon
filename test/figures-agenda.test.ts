import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clearScopes } from '../src/ui/state.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import './close.js'
import type { Agenda } from '../src/ui/format.js'

// src/ui/figures/agenda.ts, figure 7 (issue #208): the domain x person coverage-share grid.
// Spans every tracked person at once, so mount() takes no `person` seed and the request never
// carries one. paintAgenda/paintAgendaLoading/paintAgendaError are exercised as pure painters
// too (issue #208 AC17), but the click/release contract (AC16) is this figure's own, so it goes
// through the real mount() here, the same discipline test/figures-week.test.ts follows.

const personA = { id: 'lula', name: 'Lula' }
const personB = { id: 'tarcisio', name: 'Tarcísio' }
const people = [personA, personB]

const agendaData = (over: Partial<Agenda> = {}): Agenda => ({
  days: 30,
  persons: [personA, personB],
  domains: ['g1.globo.com'],
  cells: [
    { person_id: 'lula', domain: 'g1.globo.com', docs: 8, share: 0.8 },
    { person_id: 'tarcisio', domain: 'g1.globo.com', docs: 2, share: 0.2 },
  ],
  ...over,
})

describe('figures/agenda.js is importable outside a browser, touches document only inside mount, exports exactly mount (issue #208 AC15)', async () => {
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document defined at import time')
  const mod = await import('../src/ui/figures/agenda.js')
  it('does not touch document at import time', () => {
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/agenda.js must not touch document')
  })
  it('exports exactly mount', () => {
    assert.deepEqual(Object.keys(mod), ['mount'])
    assert.equal(typeof mod.mount, 'function')
  })
})

describe('(mount): fetches /api/agenda with the figure own days/source, no person control (issue #208 AC15)', () => {
  it('requests /api/agenda with the selected days and source, and no domain/lean/kind/limit', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/agenda': agendaData() })
      const { mount } = await import('../src/ui/figures/agenda.js')
      mount(els.agenda, { people, initial: { days: '7', source: 'gdelt' } })
      await flush()
      const url = calls.find((u) => u.includes('/agenda'))
      assert.ok(url, 'must have requested /api/agenda')
      assert.match(url!, /\/api\/agenda\?/)
      const qs = new URL(url!, 'http://localhost').searchParams
      assert.equal(qs.get('days'), '7')
      assert.equal(qs.get('source'), 'gdelt')
      for (const absent of ['domain', 'lean', 'kind', 'limit', 'person', 'min']) assert.equal(qs.get(absent), null, `${absent} must not be sent`)
    })
  })

  it('paints the grid on success with one row per domain and one column per tracked person', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/agenda': agendaData() })
      const { mount } = await import('../src/ui/figures/agenda.js')
      mount(els.agenda, { people, initial: {} })
      await flush()
      assert.equal(els.agendaGrid.hidden, false)
      assert.match(els.agendaGrid.innerHTML, /g1\.globo\.com/)
      assert.match(els.agendaGrid.innerHTML, /data-person="lula"/)
      assert.match(els.agendaGrid.innerHTML, /data-person="tarcisio"/)
      assert.match(els.agendaGrid.innerHTML, /80%/)
      assert.match(els.agendaGrid.innerHTML, /20%/)
    })
  })

  it('renders no em dash for a person with no cell on a domain, an sr-only label instead (validator gap #1)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/agenda': agendaData({
          domains: ['g1.globo.com', 'g2.example'],
          cells: [
            { person_id: 'lula', domain: 'g1.globo.com', docs: 8, share: 0.8 },
            { person_id: 'tarcisio', domain: 'g1.globo.com', docs: 2, share: 0.2 },
            // tarcisio has no cell here: g2.example is lula-only.
            { person_id: 'lula', domain: 'g2.example', docs: 5, share: 1 },
          ],
        }),
      })
      const { mount } = await import('../src/ui/figures/agenda.js')
      mount(els.agenda, { people, initial: {} })
      await flush()
      assert.doesNotMatch(els.agendaGrid.innerHTML, /—/, 'an empty cell must never render an em dash')
      assert.match(els.agendaGrid.innerHTML, /sr-only">sem documentos</)
    })
  })

  it('the trailing note names the row (linha) as the share axis, never the column (validator gap #2)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/agenda': agendaData() })
      const { mount } = await import('../src/ui/figures/agenda.js')
      mount(els.agenda, { people, initial: {} })
      await flush()
      assert.match(els.agendaGrid.innerHTML, /\blinha\b/)
      assert.doesNotMatch(els.agendaGrid.innerHTML, /\bcoluna\b/)
    })
  })
})

describe('picking a cell opens the docs card with exactly one side, no term (issue #208 AC16)', () => {
  it('sends domain=, days, source, that one person, and no term; releasing closes the card', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/agenda': agendaData(), '/docs': { docs: [], total: 0 } })
      const { mount } = await import('../src/ui/figures/agenda.js')
      mount(els.agenda, { people, initial: { source: 'gnews' } })
      await flush()
      const cells = [...els.agendaGrid.querySelectorAll('[data-person]')] as any[]
      const cell = cells.find((el) => el.dataset.person === 'lula' && el.dataset.domain === 'g1.globo.com')
      assert.ok(cell, 'the lula/g1.globo.com cell must be reachable by its data-person/data-domain stub')
      cell.fire('click')
      await flush()
      const docsUrl = calls.find((u) => u.includes('/docs'))
      assert.ok(docsUrl, 'picking a cell must request /docs')
      assert.match(docsUrl!, /\/api\/people\/lula\/docs\?/)
      const qs = new URL(docsUrl!, 'http://localhost').searchParams
      assert.equal(qs.get('domain'), 'g1.globo.com')
      assert.equal(qs.get('source'), 'gnews')
      assert.equal(qs.get('term'), '')
      assert.equal(els.docsDialog.open, true)
      cell.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, false, 'clicking the same cell again releases the pick and closes the card')
    })
  })

  it('picking a different cell opens the card for that other person, never mixing the two sides (issue #208 AC16)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/agenda': agendaData(), '/docs': { docs: [], total: 0 } })
      const { mount } = await import('../src/ui/figures/agenda.js')
      mount(els.agenda, { people, initial: {} })
      await flush()
      const cells = [...els.agendaGrid.querySelectorAll('[data-person]')] as any[]
      cells.find((el) => el.dataset.person === 'tarcisio')!.fire('click')
      await flush()
      const docsUrl = calls.filter((u) => u.includes('/docs')).pop()
      assert.match(docsUrl!, /\/api\/people\/tarcisio\/docs\?/)
    })
  })

  it('clicking empty background releases the pick and closes the card this figure opened', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/agenda': agendaData(), '/docs': { docs: [], total: 0 } })
      const { mount } = await import('../src/ui/figures/agenda.js')
      mount(els.agenda, { people, initial: {} })
      await flush()
      const cells = [...els.agendaGrid.querySelectorAll('[data-person]')] as any[]
      cells[0].fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      els.agendaGrid.fire('click', { target: { closest: () => null } })
      await flush()
      assert.equal(els.docsDialog.open, false, 'a background click on the figure releases the pick it owns')
    })
  })
})

describe('the empty state paints a note, not an empty grid; the loading state paints a ghost, never the previous data (issue #208 AC17)', () => {
  it('domains.length === 0 paints a note naming the min threshold, not a bare empty table', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/agenda': agendaData({ domains: [], cells: [] }) })
      const { mount } = await import('../src/ui/figures/agenda.js')
      mount(els.agenda, { people, initial: {} })
      await flush()
      assert.equal(els.agendaGrid.hidden, false)
      assert.doesNotMatch(els.agendaGrid.innerHTML, /<table/)
      assert.match(els.agendaGrid.innerHTML, /Nenhum veículo atingiu o mínimo/)
    })
  })

  it('a load in flight paints a ghost of the grid own shape, not the word Carregando and not the previous dataset', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/agenda': agendaData() })
      const { mount } = await import('../src/ui/figures/agenda.js')
      mount(els.agenda, { people, initial: {} })
      // Before the fetch settles, the synchronous ghost() call inside figure.ts's load() has
      // already run: the grid must show a ghost skeleton, not the literal word "Carregando".
      assert.match(els.agendaGrid.innerHTML, /agenda-ghost/)
      assert.doesNotMatch(els.agendaGrid.innerHTML, /Carregando/)
      await flush()
      assert.match(els.agendaGrid.innerHTML, /g1\.globo\.com/, 'the real data replaces the ghost once the fetch settles')
    })
  })

  it('a failed fetch paints the error note and never leaves the loading ghost on screen', async () => {
    await withFiguresDom(async (els) => {
      clearScopes()
      globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch
      const { mount } = await import('../src/ui/figures/agenda.js')
      mount(els.agenda, { people, initial: {} })
      await flush()
      assert.match(els.agendaGrid.innerHTML, /Não foi possível carregar a agenda/)
      assert.doesNotMatch(els.agendaGrid.innerHTML, /agenda-ghost/, 'the loading ghost must not survive a failed request')
      assert.match(els.agendaGrid.innerHTML, /class="quiet-button" id="agendaErrorRetry">Tentar novamente</, 'a retry button must be offered (validator gap #4)')
    })
  })

  it('an outage in /api/people travels down as peopleError, painted as a retry note, not an empty grid', async () => {
    await withFiguresDom(async (els) => {
      clearScopes()
      const { mount } = await import('../src/ui/figures/agenda.js')
      mount(els.agenda, { people: [], initial: {}, peopleError: new Error('boom') })
      await flush()
      assert.match(els.agendaGrid.innerHTML, /Falha de rede ou base indisponível/)
    })
  })

  it('a cell with docs but a share rounding to 0 paints "<1%", never "0%" (review fix: ink never sits on the zero stop)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/agenda': agendaData({ cells: [{ person_id: 'lula', domain: 'g1.globo.com', docs: 1, share: 0 }] }) })
      const { mount } = await import('../src/ui/figures/agenda.js')
      mount(els.agenda, { people, initial: {} })
      await flush()
      assert.match(els.agendaGrid.innerHTML, /&lt;1%/)
      assert.doesNotMatch(els.agendaGrid.innerHTML, />0%</)
      assert.match(els.agendaGrid.innerHTML, /--share:1%/)
    })
  })
})
