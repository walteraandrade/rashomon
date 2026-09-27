import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clearScopes } from '../src/ui/state.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import './close.js'
import type { Comention } from '../src/ui/format.js'

// src/ui/figures/comention.ts, figure 7 (issue #207): its own mount(), the matrix paint
// (paintComention/paintComentionLoading/paintComentionError are exercised directly, as pure
// painters, in test/render.test.ts and matrixLayout in test/layout.test.ts), and the docs-card
// wiring a filled cell opens -- one side, the row person's own docs filtered to the column
// person via `with=` -- which is this figure's own contract (AC10).

const personA = { id: 'bolsonaro', name: 'Bolsonaro' }
const personB = { id: 'lula', name: 'Lula' }
const personC = { id: 'tarcisio', name: 'Tarcísio' }
const people = [personA, personB, personC]

const comentionData = (pairs: Comention['pairs']): Comention => ({ days: 30, persons: people, pairs })

describe('figures/comention.js is importable outside a browser, touches document only inside mount, exports exactly mount', async () => {
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document defined at import time')
  const mod = await import('../src/ui/figures/comention.js')
  it('does not touch document at import time', () => {
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/comention.js must not touch document')
  })
  it('exports exactly mount (AC9)', () => {
    assert.deepEqual(Object.keys(mod), ['mount'])
    assert.equal(typeof mod.mount, 'function')
  })
})

describe('(mount): fetches /api/comention with the selected days/source/lean/min', () => {
  it('requests /api/comention with the current control values', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/comention': comentionData([]) })
      const { mount } = await import('../src/ui/figures/comention.js')
      mount(els.comention, { people, initial: { days: '7', source: 'gdelt', lean: 'left', min: '5' } })
      await flush()
      const url = calls.find((u) => u.includes('/api/comention'))
      assert.ok(url, 'must have requested /api/comention')
      const qs = new URL(url!, 'http://localhost').searchParams
      assert.equal(qs.get('days'), '7')
      assert.equal(qs.get('source'), 'gdelt')
      assert.equal(qs.get('lean'), 'left')
      assert.equal(qs.get('min'), '5')
    })
  })
})

describe('clicking a filled matrix cell opens the docs card with one side (issue #207, AC10)', () => {
  it('calls open scoped to the row person, filtered to the column person via with=, never two sides', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/comention': comentionData([{ a: 'lula', b: 'tarcisio', count: 5 }]) })
      const { mount } = await import('../src/ui/figures/comention.js')
      mount(els.comention, { people, initial: {} })
      await flush()
      assert.equal(els.comentionMatrix.hidden, false)
      const cell = [...els.comentionMatrix.querySelectorAll('[data-a]')].find((c: any) => c.dataset.a === 'lula' && c.dataset.b === 'tarcisio')
      assert.ok(cell, 'must have painted a filled, clickable cell for the lula/tarcisio pair')
      cell.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true, 'picking a filled cell opens the docs card')
      const docsUrls = calls.filter((u) => u.includes('/docs?'))
      assert.equal(docsUrls.length, 1, 'a comention pick is one person filtered by with=, never two /docs requests')
      assert.match(docsUrls[0], /\/api\/people\/lula\/docs\?/, 'the side is the row person (a), not the column person')
      const qs = new URL(docsUrls[0], 'http://localhost').searchParams
      assert.equal(qs.get('with'), 'tarcisio', 'the other person of the pair travels as with=')
    })
  })

  it('a blank cell (below min, or zero shared docs) is not clickable', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/comention': comentionData([]) })
      const { mount } = await import('../src/ui/figures/comention.js')
      mount(els.comention, { people, initial: {} })
      await flush()
      assert.equal(els.comentionMatrix.querySelectorAll('[data-a]').length, 0, 'an empty pairs response paints no clickable cell at all')
    })
  })

  it('clicking the same cell again releases the selection and closes the card', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/comention': comentionData([{ a: 'lula', b: 'tarcisio', count: 5 }]) })
      const { mount } = await import('../src/ui/figures/comention.js')
      mount(els.comention, { people, initial: {} })
      await flush()
      const cell = () => [...els.comentionMatrix.querySelectorAll('[data-a]')].find((c: any) => c.dataset.a === 'lula' && c.dataset.b === 'tarcisio')
      cell()!.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      cell()!.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, false, 'a second click on the same cell releases the pick and closes the card')
    })
  })

  it('clicking empty space in the figure releases the selection and closes the card', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/comention': comentionData([{ a: 'lula', b: 'tarcisio', count: 5 }]) })
      const { mount } = await import('../src/ui/figures/comention.js')
      mount(els.comention, { people, initial: {} })
      await flush()
      const cell = [...els.comentionMatrix.querySelectorAll('[data-a]')].find((c: any) => c.dataset.a === 'lula' && c.dataset.b === 'tarcisio')
      cell!.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      els.comentionMatrix.fire('click', { target: { closest: () => null } })
      await flush()
      assert.equal(els.docsDialog.open, false, 'a background click in the figure releases the pick it owns')
    })
  })

  it('pressing Escape releases the pick and closes the card', async () => {
    await withFiguresDom(async (els, calls, fireDocumentKeydown) => {
      clearScopes()
      routeFetch(calls, { '/api/comention': comentionData([{ a: 'lula', b: 'tarcisio', count: 5 }]) })
      const { mount } = await import('../src/ui/figures/comention.js')
      mount(els.comention, { people, initial: {} })
      await flush()
      const cell = [...els.comentionMatrix.querySelectorAll('[data-a]')].find((c: any) => c.dataset.a === 'lula' && c.dataset.b === 'tarcisio')
      cell!.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      fireDocumentKeydown('Escape')
      await flush()
      assert.equal(els.docsDialog.open, false)
    })
  })
})
