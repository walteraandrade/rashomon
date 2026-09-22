import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { Effect, Exit, Fiber } from 'effect'
import { TestConsole } from 'effect/testing'
import { camara, collect } from '../src/collectors/camara.js'
import { collectors, defaultSources } from '../src/collectors/index.js'
import type { Person } from '../src/types.js'
import { drain, fakeFetch, json, runProgram, runTest, tick } from './effect.js'

const readRepoFile = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')

const dep = (id: string, camaraId: string): Person => ({ id, name: id, aliases: [id], camaraId })

describe('camara collector', () => {
  it('exports camara as an async (persons: Person[]) => Promise<RawDoc[]>', async () => {
    const result = camara([])
    assert.ok(result instanceof Promise)
    assert.deepEqual(await result, [])
  })

  it('a person without camaraId produces zero HTTP requests and zero log lines', async () => {
    const noCamaraId: Person = { id: 'sem-camara', name: 'Sem Câmara', aliases: ['Sem Câmara'] }
    const fetchFn = fakeFetch(() => {
      throw new Error('must never be called')
    })
    const docs = await runProgram(collect([noCamaraId]), fetchFn)
    assert.deepEqual(docs, [])
    assert.equal(fetchFn.calls.length, 0)
  })

  it('collectors registers camara and defaultSources includes it', () => {
    assert.equal(typeof collectors.camara, 'function')
    assert.ok(defaultSources.includes('camara'), 'camara must be a default, not opt-in, source')
  })

  it('camaraId is set only on the verified sitting/former deputies, each a numeric id', () => {
    const seedData = JSON.parse(readRepoFile('seed.json')) as Array<{ id: string; camaraId?: string }>
    const withId = seedData.filter((p) => p.camaraId).map((p) => p.id).sort()
    assert.deepEqual(withId, ['bolsonaro', 'eduardo-bolsonaro', 'hugo-motta', 'nikolas'].sort())
    for (const p of seedData) if (p.camaraId) assert.match(p.camaraId, /^\d+$/)
  })

  it('every mapped RawDoc carries source: "camara" and never a tone', async () => {
    const person = dep('dep', '123')
    const fetchFn = fakeFetch(() => json({ dados: [{ dataHoraInicio: '2026-07-01T10:00:00', sumario: 'fala' }] }))
    const exit = await runTest(drain(collect([person]), 1_000), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.ok(Exit.isSuccess(exit.value.exit))
    const docs = exit.value.exit.value
    assert.equal(docs.length, 1)
    assert.equal(docs[0].source, 'camara')
    assert.equal('tone' in docs[0], false)
  })

  describe('retry timing', () => {
    it('429 then 500 then 200 makes exactly three requests, waiting 4 000ms then 8 000ms between them', async () => {
      const person = dep('dep', '123')
      let n = 0
      const fetchFn = fakeFetch(() => {
        n++
        if (n === 1) return new Response('rate limited', { status: 429 })
        if (n === 2) return new Response('server error', { status: 500 })
        return json({ dados: [] })
      })
      const program = Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(collect([person]))
        yield* tick()
        assert.equal(fetchFn.calls.length, 1, 'the first attempt fires immediately')

        yield* tick(3_999)
        assert.equal(fetchFn.calls.length, 1, 'must not retry before 4 000ms have passed')
        yield* tick(1)
        assert.equal(fetchFn.calls.length, 2, 'retries at exactly 4 000ms')

        yield* tick(7_999)
        assert.equal(fetchFn.calls.length, 2, 'must not retry before a further 8 000ms have passed')
        yield* tick(1)
        assert.equal(fetchFn.calls.length, 3, 'retries at exactly a further 8 000ms')

        yield* tick(2_000) // drains the final pacing pause so the fiber settles
        const inner = yield* Fiber.await(fiber)
        const logs = yield* TestConsole.logLines
        return { inner, logs: logs.map(String) }
      })
      const { inner, logs } = await runProgram(program, fetchFn)
      assert.ok(Exit.isSuccess(inner))
      assert.ok(logs.includes('[camara] 123: 429, retrying in 4s (attempt 1/3)'))
      assert.ok(logs.includes('[camara] 123: 500, retrying in 8s (attempt 2/3)'))
      assert.ok(logs.includes('[camara] dep: 0 speeches'))
    })

    it('a fourth consecutive 429 fails that person, logged, and the next person still gets its own request', async () => {
      const a = dep('a', '111')
      const b = dep('b', '222')
      const fetchFn = fakeFetch((c) => (c.url.pathname.includes('/111/') ? new Response('slow down', { status: 429 }) : json({ dados: [] })))
      const program = Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(collect([a, b]))
        yield* tick()
        yield* tick(4_000)
        yield* tick(8_000)
        yield* tick(12_000)
        yield* tick(2_000)
        const inner = yield* Fiber.await(fiber)
        const errors = yield* TestConsole.errorLines
        return { inner, errors: errors.map(String) }
      })
      const { inner, errors } = await runProgram(program, fetchFn)
      assert.ok(Exit.isSuccess(inner))
      const aCalls = fetchFn.calls.filter((c) => c.url.pathname.includes('/111/'))
      assert.equal(aCalls.length, 4, 'a: one initial attempt plus three retries, then gives up')
      const bCalls = fetchFn.calls.filter((c) => c.url.pathname.includes('/222/'))
      assert.equal(bCalls.length, 1, 'b still gets its own request after a fails')
      assert.equal(errors.length, 1)
      assert.match(errors[0], /^\[camara\] a: camara 429:/)
    })
  })
})
