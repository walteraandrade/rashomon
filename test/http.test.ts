import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Cause, Exit } from 'effect'
import * as http from '../src/http.js'
import { MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, ResponseTooLarge, getBytes, headerLength, overLimit } from '../src/http.js'
import { drain, fakeFetch, failureOf, hanging, runTest } from './effect.js'

describe('MAX_RESPONSE_BYTES', () => {
  it('is 32 MB', () => {
    assert.equal(MAX_RESPONSE_BYTES, 32 * 1024 * 1024)
  })
})

describe('http.ts export surface — the Promise helpers are gone, the Effect boundary stays', () => {
  it('no longer exports sleep, sequential, readCapped, slowGet, SlowResponse or CappedRead', () => {
    for (const name of ['sleep', 'sequential', 'readCapped', 'slowGet', 'SlowResponse', 'CappedRead']) {
      assert.equal(name in http, false, `http.ts must no longer export ${name}`)
    }
  })

  it('still exports getBytes, fetchClient, runWithFetch, overLimit, headerLength, ResponseTooLarge, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS and headers', () => {
    for (const name of ['getBytes', 'fetchClient', 'runWithFetch', 'overLimit', 'headerLength', 'ResponseTooLarge', 'MAX_RESPONSE_BYTES', 'REQUEST_TIMEOUT_MS', 'headers']) {
      assert.equal(name in http, true, `http.ts must still export ${name}`)
    }
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

// getBytes is the request every collector makes (gdelt, camara, senado, rss, gkg), exercised
// against a stub fetch: one call site carries both the byte cap and the wall-clock cap.
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

  it('a silent connection is cut at REQUEST_TIMEOUT_MS by default and the fetch is aborted', async () => {
    const fetchFn = fakeFetch(hanging)
    const exit = await runTest(drain(getBytes(url), REQUEST_TIMEOUT_MS), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    const { exit: inner, elapsedMs } = exit.value
    assert.ok(Cause.isTimeoutError(failureOf(inner)))
    assert.equal(elapsedMs, REQUEST_TIMEOUT_MS)
    assert.equal(fetchFn.calls[0].signal.aborted, true)
  })

  it('a silent connection is cut at a non-default timeoutMs, not REQUEST_TIMEOUT_MS', async () => {
    const timeoutMs = 5_000
    const fetchFn = fakeFetch(hanging)
    const exit = await runTest(drain(getBytes(url, MAX_RESPONSE_BYTES, timeoutMs), timeoutMs), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    const { exit: inner, elapsedMs } = exit.value
    assert.ok(Cause.isTimeoutError(failureOf(inner)))
    assert.equal(elapsedMs, timeoutMs)
    assert.equal(fetchFn.calls[0].signal.aborted, true)
  })
})

describe('the collector layer\'s Effect-only export surface (issue #183)', () => {
  it('getBytes cuts a never-resolving fetch at an explicit, non-default timeoutMs, aborting the underlying request (issue #183 AC2)', async () => {
    const url = 'https://example.test/ac2'
    const timeoutMs = 12_345
    const fetchFn = fakeFetch(hanging)
    const exit = await runTest(drain(getBytes(url, MAX_RESPONSE_BYTES, timeoutMs), timeoutMs), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    const { exit: inner, elapsedMs } = exit.value
    assert.ok(Cause.isTimeoutError(failureOf(inner)), 'a timeoutMs cutoff must fail as a TimeoutError')
    assert.equal(elapsedMs, timeoutMs, 'must be cut at exactly the given timeoutMs, not REQUEST_TIMEOUT_MS')
    assert.equal(fetchFn.calls[0].signal.aborted, true, 'the fetch call must be aborted, not merely abandoned')
  })
})
