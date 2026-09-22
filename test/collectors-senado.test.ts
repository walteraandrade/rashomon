import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { Effect, Exit, Fiber } from 'effect'
import { TestConsole } from 'effect/testing'
import { collect, hasUsableDate, senado, toRawDoc } from '../src/collectors/senado.js'
import { collectors, defaultSources } from '../src/collectors/index.js'
import type { Person, Source } from '../src/types.js'
import { docs } from './fixture.js'
import { drain, fakeFetch, runProgram, runTest, tick } from './effect.js'

const pauseMs = 500

describe('senado collector', () => {
  it('returns [] for an empty person list, no request made', async () => {
    const fetchFn = fakeFetch(() => {
      throw new Error('must never be called')
    })
    const docs = await runProgram(collect([]), fetchFn)
    assert.deepEqual(docs, [])
    assert.equal(fetchFn.calls.length, 0)
  })

  it('returns [] when every person lacks senadoId, no request made', async () => {
    const persons: Person[] = [
      { id: 'lula', name: 'Lula', aliases: ['Lula'] },
      { id: 'tarcisio', name: 'Tarcísio', aliases: ['Tarcísio'], exclude: ['C'] },
    ]
    const fetchFn = fakeFetch(() => {
      throw new Error('must never be called')
    })
    const result = await runProgram(collect(persons), fetchFn)
    assert.deepEqual(result, [])
    assert.equal(fetchFn.calls.length, 0)
  })

  it('Source includes "senado" and Person carries an optional senadoId (compile-time, pinned at runtime too)', () => {
    const source: Source = 'senado'
    const withId: Person = { id: 'x', name: 'X', aliases: [], senadoId: '123' }
    const withoutId: Person = { id: 'y', name: 'Y', aliases: [] }
    assert.equal(source, 'senado')
    assert.equal(withId.senadoId, '123')
    assert.equal(withoutId.senadoId, undefined)
  })

  it('one request per senadoId person, zero for a person without one', async () => {
    const withId: Person = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre'], senadoId: '3830' }
    const withoutId: Person = { id: 'lula', name: 'Lula', aliases: ['Lula'] }
    const fetchFn = fakeFetch(() =>
      new Response(JSON.stringify({ DiscursosParlamentar: { Parlamentar: { Pronunciamentos: {} } } }), { status: 200 }),
    )
    const exit = await runTest(drain(collect([withoutId, withId]), pauseMs), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.ok(Exit.isSuccess(exit.value.exit))
    assert.equal(fetchFn.calls.length, 1)
    assert.match(fetchFn.calls[0].url.pathname, /\/3830\//)
  })

  it('every mapped RawDoc is built with source: "senado" and never a tone', async () => {
    const person: Person = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre'], senadoId: '3830' }
    const fetchFn = fakeFetch(() =>
      new Response(
        JSON.stringify({
          DiscursosParlamentar: {
            Parlamentar: {
              Pronunciamentos: { Pronunciamento: { UrlTexto: 'https://x', TextoResumo: 'resumo', DataPronunciamento: '2026-07-14' } },
            },
          },
        }),
        { status: 200 },
      ),
    )
    const exit = await runTest(drain(collect([person]), pauseMs), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.ok(Exit.isSuccess(exit.value.exit))
    const result = exit.value.exit.value
    assert.equal(result.length, 1)
    assert.equal(result[0].source, 'senado')
    assert.equal('tone' in result[0], false)
  })

  it('a failure for one person is logged, and the next person\'s request still runs', async () => {
    const a: Person = { id: 'a', name: 'A', aliases: ['A'], senadoId: '111' }
    const b: Person = { id: 'b', name: 'B', aliases: ['B'], senadoId: '222' }
    const fetchFn = fakeFetch((c) =>
      c.url.pathname.includes('/111/')
        ? new Response('<html>not json</html>', { status: 500 })
        : new Response(JSON.stringify({ DiscursosParlamentar: { Parlamentar: { Pronunciamentos: {} } } }), { status: 200 }),
    )
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(collect([a, b]))
      yield* tick()
      yield* tick(pauseMs)
      yield* tick(pauseMs)
      const inner = yield* Fiber.await(fiber)
      const errors = yield* TestConsole.errorLines
      const logs = yield* TestConsole.logLines
      return { inner, errors: errors.map(String), logs: logs.map(String) }
    })
    const { inner, errors, logs } = await runProgram(program, fetchFn)
    assert.ok(Exit.isSuccess(inner))
    if (Exit.isSuccess(inner)) assert.deepEqual(inner.value, [])
    assert.equal(fetchFn.calls.filter((c) => c.url.pathname.includes('/111/')).length, 1)
    assert.equal(fetchFn.calls.filter((c) => c.url.pathname.includes('/222/')).length, 1)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^\[senado\] a: senado 500: <html>not json<\/html>$/)
    assert.ok(logs.includes('[senado] a: 0 pronunciamentos'))
  })

  it('collectors/index.ts registers senado in the collectors map and in defaultSources', () => {
    assert.equal(typeof collectors.senado, 'function')
    assert.ok(defaultSources.includes('senado'), 'senado must be a default, not opt-in, source')
  })

  it('the fixture carries exactly one senado doc, dated past every pinned window in the suite', () => {
    const senadoDocs = docs.filter((d) => d.source === 'senado')
    assert.equal(senadoDocs.length, 1)
    const ageDays = (Date.now() - new Date(senadoDocs[0].publishedAt).getTime()) / 86_400_000
    assert.ok(ageDays > 3100, `expected senado doc older than 3100 days, got ${ageDays.toFixed(0)}`)
    // the resumo body never names the senator: only the name-prefix tags it (test/extract.test.ts)
    assert.doesNotMatch(senadoDocs[0].text.replace(/^[^:]+:\s*/, ''), /Alcolumbre/i)
  })

  it('seed.json grants senadoId to exactly flavio-bolsonaro (5894) and alcolumbre (3830), no other entry', () => {
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

  it('senado (the Promise Collector) matches the empty-persons short-circuit, no network', async () => {
    const start = Date.now()
    assert.deepEqual(await senado([]), [])
    assert.ok(Date.now() - start < 1000, 'must short-circuit before any request, not merely resolve an empty batch')
  })
})
