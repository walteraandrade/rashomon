import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clearScopes } from '../src/ui/state.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import './close.js'
import type { Comention } from '../src/ui/format.js'

// src/ui/figures/comention.ts, figure 7 (issue #207): its own mount(), the docs-card wiring a
// filled cell opens -- one side, the row person's own docs filtered to the column person via
// `with=` -- which is this figure's own contract (AC10). paintComention/paintComentionLoading/
// paintComentionError are exercised directly, as pure painters, in test/render.test.ts; matrixLayout
// is exercised directly in test/layout.test.ts.

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

describe('the grid cell and the ranked list item for the same pair open the same docs (issue #235 review)', () => {
  // dino's name (Aline) sorts before bolsonaro's (Zeca), the reverse of their id order
  // (bolsonaro < dino): matrixLayout's row/column order follows the names, so the grid's cell
  // carries data-a="dino" data-b="bolsonaro" (row, then column), while /api/comention's own
  // pairs -- and so the ranked list -- carry the pair's own a/b, the smaller id first:
  // data-a="bolsonaro" data-b="dino". Both must still open the same side of the same pair.
  const dino = { id: 'dino', name: 'Aline' }
  const bolsonaro = { id: 'bolsonaro', name: 'Zeca' }

  it('open with the same side (a=bolsonaro, with=dino) whichever one is clicked', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/comention': { days: 30, persons: [dino, bolsonaro], pairs: [{ a: 'bolsonaro', b: 'dino', count: 5 }] } as any })
      const { mount } = await import('../src/ui/figures/comention.js')
      mount(els.comention, { people: [dino, bolsonaro], initial: {} })
      await flush()

      const gridCell = [...els.comentionMatrix.querySelectorAll('[data-a]')].find((c: any) => c.dataset.a === 'dino' && c.dataset.b === 'bolsonaro')
      assert.ok(gridCell, 'the grid orders this pair a=dino, b=bolsonaro (row/column order)')
      gridCell.fire('click')
      await flush()
      const gridDocsUrl = calls.find((u) => u.includes('/docs?'))
      assert.ok(gridDocsUrl, 'clicking the grid cell must open the docs card')
      assert.match(gridDocsUrl!, /\/api\/people\/bolsonaro\/docs\?/, 'opens the pair\'s a (smaller id), not the row person')
      assert.equal(new URL(gridDocsUrl!, 'http://localhost').searchParams.get('with'), 'dino')

      // Release the grid pick before picking the list item for the same pair.
      gridCell.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, false)
      calls.length = 0
      // Both picks resolve to the exact same docs request, so the docs-card scope memo would
      // otherwise answer the list click from cache with no new fetch to inspect -- clear it so
      // the second pick's request is observable too.
      clearScopes()

      const listItem = [...els.comentionMatrix.querySelectorAll('[data-a]')].find((c: any) => c.dataset.a === 'bolsonaro' && c.dataset.b === 'dino')
      assert.ok(listItem, 'the ranked list carries the pair\'s own a=bolsonaro, b=dino')
      listItem.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true, 'clicking the list item must open the docs card')
      const listDocsUrl = calls.find((u) => u.includes('/docs?'))
      assert.ok(listDocsUrl, 'clicking the list item must issue a docs request')
      assert.equal(listDocsUrl, gridDocsUrl, 'the grid and the list must open the exact same docs request for this pair')
    })
  })
})
