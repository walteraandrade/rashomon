import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect, Exit, Fiber } from 'effect'
import { TestConsole } from 'effect/testing'
import { collect, gdelt } from '../src/collectors/gdelt.js'
import { collectors } from '../src/collectors/index.js'
import type { Person } from '../src/types.js'
import { drain, fakeFetch, json, runProgram, runTest, tick } from './effect.js'

const rateLimitMs = 5_500

const ana: Person = { id: 'ana', name: 'Ana Souza', aliases: ['Ana Souza'] }
const bento: Person = { id: 'bento', name: 'Bento Lima', aliases: ['Bento Lima'] }

describe('gdelt collector', () => {
  it('exports gdelt as an async (persons: Person[]) => Promise<RawDoc[]>', async () => {
    const result = gdelt([])
    assert.ok(result instanceof Promise)
    assert.deepEqual(await result, [])
  })

  it('collectors registers gdelt as a function (opt-in: not part of defaultSources)', () => {
    assert.equal(typeof collectors.gdelt, 'function')
  })

  it('every mapped RawDoc carries source: "gdelt", never a tone', async () => {
    const article = { url: 'https://x/1', title: 'Manchete - 01 / 01 / 2026', seendate: '20260701T100000Z', domain: 'X.com' }
    const fetchFn = fakeFetch(() => new Response(JSON.stringify({ articles: [article] }), { status: 200 }))
    const exit = await runTest(drain(collect([ana]), rateLimitMs), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.ok(Exit.isSuccess(exit.value.exit))
    const docs = exit.value.exit.value
    assert.equal(docs.length, 1)
    assert.equal(docs[0].source, 'gdelt')
    assert.equal('tone' in docs[0], false)
    assert.equal(docs[0].domain, 'x.com')
    assert.equal(docs[0].text, 'Manchete')
    assert.equal(docs[0].publishedAt, '2026-07-01T10:00:00Z')
  })

  describe('retry timing', () => {
    it('429 then 429 then 200 makes exactly three requests, waiting 22 000ms then 44 000ms between them', async () => {
      let n = 0
      const fetchFn = fakeFetch(() => {
        n++
        if (n <= 2) return new Response('slow down', { status: 429 })
        return new Response(JSON.stringify({ articles: [] }), { status: 200 })
      })
      const program = Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(collect([ana]))
        yield* tick()
        assert.equal(fetchFn.calls.length, 1, 'the first attempt fires immediately')

        yield* tick(21_999)
        assert.equal(fetchFn.calls.length, 1, 'must not retry before 22 000ms have passed')
        yield* tick(1)
        assert.equal(fetchFn.calls.length, 2, 'retries at exactly 22 000ms')

        yield* tick(43_999)
        assert.equal(fetchFn.calls.length, 2, 'must not retry before a further 44 000ms have passed')
        yield* tick(1)
        assert.equal(fetchFn.calls.length, 3, 'retries at exactly a further 44 000ms')

        yield* tick(rateLimitMs) // drains the final pacing pause so the fiber settles
        const inner = yield* Fiber.await(fiber)
        const logs = yield* TestConsole.logLines
        return { inner, logs: logs.map(String) }
      })
      const { inner, logs } = await runProgram(program, fetchFn)
      assert.ok(Exit.isSuccess(inner))
      assert.ok(logs.includes('[gdelt] ana: request 1/4 (connect takes ~15s)'))
      assert.ok(logs.includes('[gdelt] ana: 429 rate limited, waiting 22s'))
      assert.ok(logs.includes('[gdelt] ana: 0 articles'))
    })

    it('a non-JSON body fails with "gdelt <status>: <head>", logged, and the next person still gets its own request', async () => {
      const fetchFn = fakeFetch((c) =>
        c.url.searchParams.get('query')?.includes('Ana') ? new Response('<html>rate limited by cloudflare</html>', { status: 403 }) : new Response(JSON.stringify({ articles: [] }), { status: 200 }),
      )
      const program = Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(collect([ana, bento]))
        yield* tick()
        yield* tick(rateLimitMs)
        yield* tick(rateLimitMs)
        const inner = yield* Fiber.await(fiber)
        const errors = yield* TestConsole.errorLines
        return { inner, errors: errors.map(String) }
      })
      const { inner, errors } = await runProgram(program, fetchFn)
      assert.ok(Exit.isSuccess(inner))
      if (Exit.isSuccess(inner)) assert.deepEqual(inner.value, [])
      const anaCalls = fetchFn.calls.filter((c) => c.url.searchParams.get('query')?.includes('Ana'))
      assert.equal(anaCalls.length, 1, 'a non-429 status is never retried')
      const bentoCalls = fetchFn.calls.filter((c) => c.url.searchParams.get('query')?.includes('Bento'))
      assert.equal(bentoCalls.length, 1, 'bento still gets its own request after ana fails')
      assert.equal(errors.length, 1)
      assert.match(errors[0], /^\[gdelt\] ana: gdelt 403: <html>rate limited by cloudflare<\/html>$/)
    })
  })
})

describe('gdelt retry/backoff as a typed Effect (issue #183)', () => {
  it('429 then 429 then 200 makes exactly three requests, waiting exactly 22 000ms then 44 000ms; a non-JSON body fails with "gdelt <status>: <head>" (issue #183 AC8)', async () => {
    const clara: Person = { id: 'clara', name: 'Clara Nunes', aliases: ['Clara Nunes'] }
    let n = 0
    const fetchFn = fakeFetch(() => {
      n++
      if (n <= 2) return new Response('slow down', { status: 429 })
      return new Response(JSON.stringify({ articles: [] }), { status: 200 })
    })
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(collect([clara]))
      yield* tick()
      assert.equal(fetchFn.calls.length, 1)
      yield* tick(22_000)
      assert.equal(fetchFn.calls.length, 2, 'second attempt must fire at exactly 22 000ms')
      yield* tick(44_000)
      assert.equal(fetchFn.calls.length, 3, 'third attempt must fire at exactly a further 44 000ms')
      yield* tick(rateLimitMs)
      return yield* Fiber.await(fiber)
    })
    const exit = await runTest(program, fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.equal(fetchFn.calls.length, 3)

    const other: Person = { id: 'other', name: 'Other Person', aliases: ['Other Person'] }
    const brokenFetch = fakeFetch((c) =>
      c.url.searchParams.get('query')?.includes('Clara')
        ? new Response('not json at all', { status: 500 })
        : new Response(JSON.stringify({ articles: [] }), { status: 200 }),
    )
    const program2 = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(collect([clara, other]))
      yield* tick()
      yield* tick(rateLimitMs)
      yield* tick(rateLimitMs)
      const inner = yield* Fiber.await(fiber)
      const errors = (yield* TestConsole.errorLines).map(String)
      return { inner, errors }
    })
    const { inner, errors } = await runProgram(program2, brokenFetch)
    assert.ok(Exit.isSuccess(inner))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^\[gdelt\] clara: gdelt 500: not json at all$/)
    const otherCalls = brokenFetch.calls.filter((c) => c.url.searchParams.get('query')?.includes('Other'))
    assert.equal(otherCalls.length, 1, 'the next person must still make its own request')
  })
})

describe('gdelt log lines are unchanged text, read through TestConsole (issue #183)', () => {
  it('logs "[gdelt] <id>: request N/4 (connect takes ~15s)", "429 rate limited, waiting Ns" and "<n> articles" (issue #183 AC13)', async () => {
    const person: Person = { id: 'logtest', name: 'Log Test', aliases: ['Log Test'] }
    let n = 0
    const fetchFn = fakeFetch(() => {
      n++
      return n === 1 ? new Response('down', { status: 429 }) : new Response(JSON.stringify({ articles: [{ url: 'https://x', title: 't', seendate: '20260701T100000Z' }] }), { status: 200 })
    })
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(collect([person]))
      yield* tick()
      yield* tick(22_000)
      yield* tick(rateLimitMs)
      const inner = yield* Fiber.await(fiber)
      const logs = (yield* TestConsole.logLines).map(String)
      return { inner, logs }
    })
    const { inner, logs } = await runProgram(program, fetchFn)
    assert.ok(Exit.isSuccess(inner))
    assert.ok(logs.includes('[gdelt] logtest: request 1/4 (connect takes ~15s)'))
    assert.ok(logs.includes('[gdelt] logtest: 429 rate limited, waiting 22s'))
    assert.ok(logs.includes('[gdelt] logtest: 1 articles'))
  })
})

describe('gdelt: a truncated JSON body is that person\'s failure, never the run\'s', () => {
  it('logs "[gdelt] ana: <parse message>" and the next person still gets its own request', async () => {
    const fetchFn = fakeFetch((c) => (c.url.searchParams.get('query')?.includes('Ana') ? new Response('{"articles": [', { status: 200 }) : json({ articles: [] })))
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(collect([ana, bento]))
      yield* tick()
      yield* tick(rateLimitMs)
      yield* tick(rateLimitMs)
      const inner = yield* Fiber.await(fiber)
      const errors = (yield* TestConsole.errorLines).map(String)
      return { inner, errors }
    })
    const { inner, errors } = await runProgram(program, fetchFn)
    assert.ok(Exit.isSuccess(inner), 'a parse failure must be a typed failure caught per person, not a defect')
    assert.deepEqual(inner.value, [])
    assert.equal(fetchFn.calls.filter((c) => c.url.searchParams.get('query')?.includes('Bento')).length, 1, 'bento still gets its own request after ana fails')
    assert.equal(errors.length, 1)
    assert.match(errors[0], /^\[gdelt\] ana: .*JSON/)
  })
})
