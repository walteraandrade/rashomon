import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasUsableDate, senado, toRawDoc } from '../src/collectors/senado.js'
import type { Person } from '../src/types.js'

// No network call is exercised here: every person below lacks senadoId, so the collector
// must short-circuit before calling sequential/slowGet at all (CLAUDE.md: no external
// calls in tests). A hung/failed request would time the test out rather than resolve fast.
describe('senado collector (issue #25)', () => {
  it('AC2: returns [] for an empty person list, no request made', async () => {
    assert.deepEqual(await senado([]), [])
  })

  it('AC2: returns [] when every person lacks senadoId, no request made', async () => {
    const persons: Person[] = [
      { id: 'lula', name: 'Lula', aliases: ['Lula'] },
      { id: 'tarcisio', name: 'Tarcísio', aliases: ['Tarcísio'] },
    ]
    assert.deepEqual(await senado(persons), [])
  })

  describe('hasUsableDate', () => {
    it('accepts a well-formed YYYY-MM-DD date with a UrlTexto', () => {
      assert.equal(hasUsableDate({ UrlTexto: 'https://x', DataPronunciamento: '2026-07-14' }), true)
    })

    it('rejects a missing DataPronunciamento', () => {
      assert.equal(hasUsableDate({ UrlTexto: 'https://x' }), false)
    })

    it('rejects a missing UrlTexto', () => {
      assert.equal(hasUsableDate({ DataPronunciamento: '2026-07-14' }), false)
    })

    it('rejects a future "YYYY-MM-DD HH:MM:SS" variant', () => {
      assert.equal(hasUsableDate({ UrlTexto: 'https://x', DataPronunciamento: '2026-07-14 10:00:00' }), false)
    })
  })

  describe('toRawDoc', () => {
    it('never produces a bare "T00:00:00Z" publishedAt for an accepted pronunciamento', () => {
      const person: Person = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre'], senadoId: '3830' }
      const doc = toRawDoc(person, { UrlTexto: 'https://x', TextoResumo: 'resumo', DataPronunciamento: '2026-07-14' })
      assert.equal(doc.publishedAt, '2026-07-14T00:00:00Z')
      assert.equal(doc.source, 'senado')
      assert.equal(doc.tone, undefined)
    })
  })
})
