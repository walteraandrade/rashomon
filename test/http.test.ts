import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Cause, Effect, Exit } from 'effect'
import { MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, ResponseTooLarge, getBytes, headerLength, overLimit, readCapped } from '../src/http.js'
import { drain, fakeFetch, failureOf, hanging, runTest } from './effect.js'

describe('MAX_RESPONSE_BYTES', () => {
  it('is 32 MB', () => {
    assert.equal(MAX_RESPONSE_BYTES, 32 * 1024 * 1024)
  })
})

describe('overLimit — the pure byte-budget decision', () => {
  it('never trips under the limit', () => {
    assert.equal(overLimit(MAX_RESPONSE_BYTES - 1, MAX_RESPONSE_BYTES), false)
  })

  it('does not trip exactly at the limit', () => {
    assert.equal(overLimit(MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES), false)
  })

  it('trips one byte over', () => {
    assert.equal(overLimit(MAX_RESPONSE_BYTES + 1, MAX_RESPONSE_BYTES), true)
  })

  it('still reports over on a second call after tripping, no silent reset', () => {
    // Simulates a stream whose running total keeps growing after the trip point.
    assert.equal(overLimit(MAX_RESPONSE_BYTES + 1, MAX_RESPONSE_BYTES), true)
    assert.equal(overLimit(MAX_RESPONSE_BYTES + 2, MAX_RESPONSE_BYTES), true)
  })
})

describe('headerLength', () => {
  it('parses a numeric content-length', () => {
    assert.equal(headerLength('123'), 123)
  })

  it('takes the first value of a repeated header', () => {
    assert.equal(headerLength(['456', '789']), 456)
  })

  it('returns null for absent or non-numeric values', () => {
    assert.equal(headerLength(undefined), null)
    assert.equal(headerLength(null), null)
    assert.equal(headerLength('not-a-number'), null)
  })
})

const streamOf = (chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
    cancel: onCancel,
  })

describe('readCapped', () => {
  it('resolves the full body under the cap', async () => {
    const result = await readCapped(streamOf([new Uint8Array([1, 2]), new Uint8Array([3, 4])]), 10)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual([...result.data], [1, 2, 3, 4])
  })

  it('resolves oversize once the running total exceeds the cap, without a partial body', async () => {
    const result = await readCapped(streamOf([new Uint8Array(3), new Uint8Array(3)]), 4)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.bytes, 6)
  })

  it('treats a null body as empty', async () => {
    const result = await readCapped(null, 10)
    assert.deepEqual(result, { ok: true, data: new Uint8Array(0) })
  })
})

// getBytes is the request every slowGet caller makes (gdelt, camara, senado), exercised against
// a stub fetch: the same size guard readCapped applies to a web stream, now on the wire.
describe('getBytes request size guard', () => {
  const url = 'https://example.test/feed'

  it('returns status and bytes for a body under the cap; the wire carries the project user-agent and nothing else', async () => {
    const fetchFn = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 203 }))
    const exit = await runTest(getBytes(url, 10), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.equal(exit.value.status, 203)
    assert.deepEqual([...exit.value.body], [1, 2, 3])
    assert.equal(fetchFn.calls[0].method, 'GET')
    // Effect's client would add traceparent/b3 by default; fetchClient turns that off.
    assert.deepEqual([...fetchFn.calls[0].headers.entries()], [['user-agent', 'assoc-graph/0.1 (personal research)']])
  })

  it('fails on a declared content-length over the cap before reading any of the body', async () => {
    let read = false
    // highWaterMark 0: the stream pulls only on demand, so `read` means someone asked for the body.
    const body = new ReadableStream<Uint8Array>({ pull: () => void (read = true) }, { highWaterMark: 0 })
    const fetchFn = fakeFetch(() => new Response(body, { status: 200, headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } }))
    const error = failureOf(await runTest(getBytes(url), fetchFn))
    assert.ok(error instanceof ResponseTooLarge)
    assert.equal(error.stage, 'declared')
    assert.equal(error.bytes, MAX_RESPONSE_BYTES + 1)
    assert.match(error.message, /declared 33554433 bytes exceeds 33554432/)
    assert.equal(read, false)
  })

  it('fails once the running total exceeds the cap while streaming, never with a partial body', async () => {
    let cancelled = false
    const fetchFn = fakeFetch(() => new Response(streamOf([new Uint8Array(3), new Uint8Array(3), new Uint8Array(3)], () => (cancelled = true)), { status: 200 }))
    const error = failureOf(await runTest(getBytes(url, 4), fetchFn))
    assert.ok(error instanceof ResponseTooLarge)
    assert.equal(error.stage, 'streaming')
    assert.equal(error.bytes, 6)
    assert.match(error.message, /exceeded 4 bytes while streaming/)
    assert.equal(cancelled, true, 'the body stream must be cancelled, not drained')
  })

  it('a silent connection is cut at REQUEST_TIMEOUT_MS and the fetch is aborted', async () => {
    const fetchFn = fakeFetch(hanging)
    const exit = await runTest(drain(getBytes(url).pipe(Effect.timeout(REQUEST_TIMEOUT_MS)), REQUEST_TIMEOUT_MS), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    const { exit: inner, elapsedMs } = exit.value
    assert.ok(Cause.isTimeoutError(failureOf(inner)))
    assert.equal(elapsedMs, REQUEST_TIMEOUT_MS)
    assert.equal(fetchFn.calls[0].signal.aborted, true)
  })
})
