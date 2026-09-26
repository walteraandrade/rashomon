import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect, Exit, Fiber } from 'effect'
import { TestConsole } from 'effect/testing'
import { collect } from '../src/collectors/pageviews.js'
import { MAX_RESPONSE_BYTES } from '../src/http.js'
import type { Person } from '../src/types.js'
import { drain, fakeFetch, json, runProgram, runTest, tick } from './effect.js'

const person = (id: string, wikipedia?: string): Person => ({ id, name: id, aliases: [id], ...(wikipedia ? { wikipedia } : {}) })

describe('#211: pageviews collector', () => {
  it('collect([]) resolves to [] with no request', async () => {
    const fetchFn = fakeFetch(() => {
      throw new Error('must never be called')
    })
    const exit = await runTest(collect([]), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.deepEqual(exit.value, [])
    assert.equal(fetchFn.calls.length, 0)
  })

  it('a person with no wikipedia field produces zero HTTP requests and zero rows', async () => {
    const noWiki = person('sem-wiki')
    const fetchFn = fakeFetch(() => {
      throw new Error('must never be called')
    })
    const rows = await runProgram(collect([noWiki]), fetchFn)
    assert.deepEqual(rows, [])
    assert.equal(fetchFn.calls.length, 0)
  })

  it('a 200 with items maps to { person_id, day, views } rows, UTC day as-is (AC8)', async () => {
    const p = person('lula', 'Luiz Inácio Lula da Silva')
    const fetchFn = fakeFetch(() =>
      json({ items: [{ timestamp: '2026092400', views: 1532 }, { timestamp: '2026092300', views: 980 }] }),
    )
    const exit = await runTest(drain(collect([p]), 1_000), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.ok(Exit.isSuccess(exit.value.exit))
    const rows = exit.value.exit.value
    assert.deepEqual(rows, [
      { person_id: 'lula', day: '2026-09-24', views: 1532 },
      { person_id: 'lula', day: '2026-09-23', views: 980 },
    ])
    assert.ok(fetchFn.calls[0]?.url.pathname.includes('Luiz_In%C3%A1cio_Lula_da_Silva'), 'spaces become underscores before encoding')
  })

  it('drops an item that fails the storable shape (e.g. views: null) and keeps the valid one', async () => {
    const p = person('lula', 'Luiz Inácio Lula da Silva')
    const fetchFn = fakeFetch(() =>
      json({
        items: [
          { timestamp: '2026092400', views: 1532 },
          { timestamp: '2026092300', views: null },
        ],
      }),
    )
    const exit = await runTest(drain(collect([p]), 1_000), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.ok(Exit.isSuccess(exit.value.exit))
    assert.deepEqual(exit.value.exit.value, [{ person_id: 'lula', day: '2026-09-24', views: 1532 }])
  })

  it('drops an item whose timestamp spells an impossible calendar day (e.g. month 13)', async () => {
    const p = person('lula', 'Luiz Inácio Lula da Silva')
    const fetchFn = fakeFetch(() =>
      json({
        items: [
          { timestamp: '2026092400', views: 1532 },
          { timestamp: '2026132400', views: 999 },
        ],
      }),
    )
    const exit = await runTest(drain(collect([p]), 1_000), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.ok(Exit.isSuccess(exit.value.exit))
    assert.deepEqual(exit.value.exit.value, [{ person_id: 'lula', day: '2026-09-24', views: 1532 }])
  })

  it('two items landing on the same calendar day keep only the last value', async () => {
    const p = person('lula', 'Luiz Inácio Lula da Silva')
    const fetchFn = fakeFetch(() =>
      json({
        items: [
          { timestamp: '2026092400', views: 100 },
          { timestamp: '2026092412', views: 200 },
        ],
      }),
    )
    const exit = await runTest(drain(collect([p]), 1_000), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.ok(Exit.isSuccess(exit.value.exit))
    assert.deepEqual(exit.value.exit.value, [{ person_id: 'lula', day: '2026-09-24', views: 200 }])
  })

  it('a body over the cap fails with ResponseTooLarge, and the error log names it via errorMessage', async () => {
    const p = person('lula', 'Luiz Inácio Lula da Silva')
    const fetchFn = fakeFetch(() => new Response(new Uint8Array(1), { status: 200, headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } }))
    const program = Effect.gen(function* () {
      const drained = yield* drain(collect([p]), 20_000)
      const errors = (yield* TestConsole.errorLines).map(String)
      return { drained, errors }
    })
    const exit = await runTest(program, fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.ok(Exit.isSuccess(exit.value.drained.exit))
    assert.deepEqual(exit.value.drained.exit.value, [])
    assert.ok(
      exit.value.errors.some((line) => line.startsWith('[pageviews] lula: ') && line.includes('ResponseTooLarge')),
      `expected a [pageviews] error line naming ResponseTooLarge, got: ${exit.value.errors.join(' | ')}`,
    )
  })

  it('429 then 500 then 200 makes exactly three requests, waiting 4 000ms then 8 000ms, exercised entirely under TestClock (AC8)', async () => {
    const p = person('lula', 'Luiz Inácio Lula da Silva')
    let n = 0
    const fetchFn = fakeFetch(() => {
      n++
      if (n === 1) return new Response('rate limited', { status: 429 })
      if (n === 2) return new Response('server error', { status: 500 })
      return json({ items: [] })
    })
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(collect([p]))
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

      yield* tick(2_000)
      const inner = yield* Fiber.await(fiber)
      const logs = (yield* TestConsole.logLines).map(String)
      return { inner, logs }
    })
    const { inner, logs } = await runProgram(program, fetchFn)
    assert.ok(Exit.isSuccess(inner))
    assert.deepEqual(inner.value, [])
    assert.ok(logs.includes('[pageviews] Luiz Inácio Lula da Silva: 429, retrying in 4s (attempt 1/3)'))
    assert.ok(logs.includes('[pageviews] Luiz Inácio Lula da Silva: 500, retrying in 8s (attempt 2/3)'))
  })

  it('a 404 for one person skips only that person; a sibling in the same run still gets her rows written (AC9)', async () => {
    const a = person('a', 'Titulo Inexistente')
    const b = person('b', 'Titulo Existente')
    const fetchFn = fakeFetch((c) =>
      c.url.pathname.includes(encodeURIComponent('Titulo_Inexistente'))
        ? new Response('not found', { status: 404 })
        : json({ items: [{ timestamp: '2026092400', views: 42 }] }),
    )
    const program = Effect.gen(function* () {
      const drained = yield* drain(collect([a, b]), 1_000)
      const errors = (yield* TestConsole.errorLines).map(String)
      return { drained, errors }
    })
    const exit = await runTest(program, fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.ok(Exit.isSuccess(exit.value.drained.exit))
    const rows = exit.value.drained.exit.value
    assert.deepEqual(rows, [{ person_id: 'b', day: '2026-09-24', views: 42 }])
    assert.ok(
      exit.value.errors.some((line) => line.startsWith('[pageviews] a: ') && line.includes('404')),
      'logs an error naming the 404 person',
    )
  })
})
