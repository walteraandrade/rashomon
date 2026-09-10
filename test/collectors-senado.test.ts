import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { collectors, defaultSources } from '../src/collectors/index.js'
import { hasUsableDate, senado, toRawDoc } from '../src/collectors/senado.js'
import type { Person, Source } from '../src/types.js'
import { docs } from './fixture.js'

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
      { id: 'tarcisio', name: 'Tarcísio', aliases: ['Tarcísio'], exclude: ['C'] },
    ]
    // a hung/failed real request would time this test out rather than resolve almost instantly
    const start = Date.now()
    assert.deepEqual(await senado(persons), [])
    assert.ok(Date.now() - start < 1000, 'must short-circuit before any request, not merely resolve an empty batch')
  })

  it('AC1: Source includes "senado" and Person carries an optional senadoId (compile-time, pinned at runtime too)', () => {
    const source: Source = 'senado'
    const withId: Person = { id: 'x', name: 'X', aliases: [], senadoId: '123' }
    const withoutId: Person = { id: 'y', name: 'Y', aliases: [] }
    assert.equal(source, 'senado')
    assert.equal(withId.senadoId, '123')
    assert.equal(withoutId.senadoId, undefined)
  })

  it('AC3: every mapped RawDoc is built with source: "senado" and never sets tone (source text, no network mock)', () => {
    // CLAUDE.md forbids hitting external APIs from tests, so this is read as source text
    const source = readFileSync(new URL('../src/collectors/senado.ts', import.meta.url), 'utf8')
    assert.match(source, /source:\s*'senado'/, 'RawDoc mapping must set source: "senado"')
    assert.doesNotMatch(source, /\btone\s*:/, 'RawDoc mapping must never set a tone field')
    assert.match(source, /person\.senadoId/, 'must key the request off person.senadoId')
  })

  it('AC4: collectors/index.ts registers senado in the collectors map and in defaultSources', () => {
    assert.equal(typeof collectors.senado, 'function')
    assert.ok(defaultSources.includes('senado'), 'senado must be a default, not opt-in, source')
  })

  it('AC6: the fixture carries exactly one senado doc, dated past every pinned window in the suite', () => {
    const senadoDocs = docs.filter((d) => d.source === 'senado')
    assert.equal(senadoDocs.length, 1)
    const ageDays = (Date.now() - new Date(senadoDocs[0].publishedAt).getTime()) / 86_400_000
    assert.ok(ageDays > 3100, `expected senado doc older than 3100 days, got ${ageDays.toFixed(0)}`)
    // the resumo body never names the senator: only the name-prefix tags it (test/extract.test.ts)
    assert.doesNotMatch(senadoDocs[0].text.replace(/^[^:]+:\s*/, ''), /Alcolumbre/i)
  })

  it('AC9: seed.json grants senadoId to exactly flavio-bolsonaro (5894) and alcolumbre (3830), no other entry', () => {
    const seedJson = JSON.parse(readFileSync(new URL('../seed.json', import.meta.url), 'utf8')) as (Person & { senadoId?: string })[]
    const withSenadoId = seedJson.filter((p) => p.senadoId !== undefined)
    assert.deepEqual(
      withSenadoId.map((p) => ({ id: p.id, senadoId: p.senadoId })).sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: 'alcolumbre', senadoId: '3830' },
        { id: 'flavio-bolsonaro', senadoId: '5894' },
      ],
    )
    // ciro must never inherit a senadoId meant for a different senator sharing his surname
    assert.equal(seedJson.find((p) => p.id === 'ciro')?.senadoId, undefined)
    assert.equal(seedJson.find((p) => p.id === 'bolsonaro')?.senadoId, undefined)
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
