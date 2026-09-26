import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect, Exit, Fiber } from 'effect'
import { TestConsole } from 'effect/testing'
import { collect } from '../src/collectors/pageviews.js'
import type { Person } from '../src/types.js'
import { drain, fakeFetch, json, runProgram, runTest, tick } from './effect.js'

const person = (id: string, wikipedia?: string): Person => ({ id, name: id, aliases: [id], ...(wikipedia ? { wikipedia } : {}) })

describe('pageviews collector', () => {
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

  it('a 200 with items maps to { person_id, day, views } rows, UTC day as-is', async () => {
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
  })

  it('429 then 500 then 200 makes exactly three requests, waiting 4 000ms then 8 000ms', async () => {
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

  it('a 404 for one person skips only that person; a sibling in the same run still gets her rows written', async () => {
    const a = person('a', 'Titulo Inexistente')
    const b = person('b', 'Titulo Existente')
    const fetchFn = fakeFetch((c) =>
      c.url.pathname.includes(encodeURIComponent('Titulo Inexistente'))
        ? new Response('not found', { status: 404 })
        : json({ items: [{ timestamp: '2026092400', views: 42 }] }),
    )
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(collect([a, b]))
      yield* tick()
      yield* tick(1_000)
      yield* tick(1_000)
      return yield* Fiber.await(fiber)
    })
    const inner = await runTest(program, fetchFn)
    assert.ok(Exit.isSuccess(inner))
    const rows = Exit.isSuccess(inner) && Exit.isSuccess(inner.value) ? inner.value.value : []
    assert.deepEqual(rows, [{ person_id: 'b', day: '2026-09-24', views: 42 }])
  })
})
