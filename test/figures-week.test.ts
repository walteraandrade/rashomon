import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clearScopes } from '../src/ui/state.js'
import { docsQuery } from '../src/ui/figures/week.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import type { Week } from '../src/ui/format.js'
import './close.js'

const people = [
  { id: 'lula', name: 'Lula' },
  { id: 'bolsonaro', name: 'Bolsonaro' },
]

const weekData = (terms: { term: string; kind: string; count: number }[] = [{ term: 'reforma', kind: 'word', count: 3 }]): Week => ({
  days: 7,
  tz: 'America/Sao_Paulo',
  buckets: Array.from({ length: 7 }, (_, i) => ({
    start: new Date(Date.UTC(2026, 8, 5 + i, 3)).toISOString(),
    about: i === 6 ? 3 : 0,
    terms: i === 6 ? terms : [],
  })),
})

describe('figures/week.js (issue #147)', async () => {
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document defined at import time')
  const mod = await import('../src/ui/figures/week.js')

  it('does not touch document at import time and exports mount + docsQuery', () => {
    assert.equal((globalThis as { document?: unknown }).document, undefined)
    assert.deepEqual(Object.keys(mod).sort(), ['docsQuery', 'mount'])
  })

  it('docsQuery carries day, days=7 and the figure source', () => {
    const q = docsQuery('gnews', { term: 'reforma', kind: 'word' }, '2026-09-08')
    assert.equal(q.get('day'), '2026-09-08')
    assert.equal(q.get('days'), '7')
    assert.equal(q.get('source'), 'gnews')
    assert.equal(q.get('term'), 'reforma')
    assert.equal(q.get('kind'), 'word')
  })

  it('sentence chips are person, source and limit; the request is always days=7', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/week': weekData() })
      mod.mount(els.week, { people, initial: { person: 'lula', source: 'gnews', limit: '5' } })
      await flush()
      assert.equal(els.weekPerson.value, 'lula')
      assert.equal(els.weekSource.value, 'gnews')
      assert.equal(els.weekLimit.value, '5')
      const weekCall = calls.find((u) => u.includes('/week'))
      assert.ok(weekCall)
      assert.match(weekCall!, /days=7/)
      assert.match(weekCall!, /limit=5/)
      assert.match(weekCall!, /source=gnews/)
    })
  })

  it('picking a word asks /docs with that calendar day; a second click releases', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/week': weekData(), '/docs': { total: 0, docs: [], outlets: [] } })
      mod.mount(els.week, { people, initial: {} })
      await flush()
      const mark = els.weekChart.querySelectorAll('[data-term]')[0] as unknown as { dataset: { term: string; kind: string; day: string }; fire: (t: string) => void }
      assert.ok(mark, 'paintWeek must emit a clickable mark')
      mark.fire('click')
      await flush()
      const docsCall = calls.find((u) => u.includes('/docs'))
      assert.ok(docsCall, `expected a /docs request, got ${JSON.stringify(calls)}`)
      assert.match(docsCall!, /term=reforma/)
      assert.match(docsCall!, /day=2026-09-11/)
      const before = calls.length
      mark.fire('click')
      await flush()
      assert.equal(calls.slice(before).filter((u) => u.includes('/docs')).length, 0)
    })
  })

  it('an empty week keeps the about pulse and the empty copy', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/week': weekData([]) })
      mod.mount(els.week, { people, initial: {} })
      await flush()
      assert.match(els.weekChart.innerHTML, /Não há palavras suficientes nesta semana/)
      assert.doesNotMatch(els.weekChart.innerHTML, /data-term/)
    })
  })

  it('a people-fetch failure is an outage, not an empty seed', async () => {
    await withFiguresDom(async (els) => {
      clearScopes()
      mod.mount(els.week, { people: [], initial: {}, peopleError: new Error('down') })
      await flush()
      assert.match(els.weekChart.innerHTML, /Falha de rede ou base indispon/)
      assert.doesNotMatch(els.weekChart.innerHTML, /seed\.json/)
    })
  })

  it('first load paints the seven-column ghost', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      globalThis.fetch = (() => new Promise(() => {})) as typeof fetch
      mod.mount(els.week, { people, initial: {} })
      assert.match(els.weekChart.innerHTML, /week-grid/)
      assert.match(els.weekChart.innerHTML, /Lendo a semana/)
      assert.doesNotMatch(els.weekChart.innerHTML, /Carregando/)
      void calls
    })
  })
})
