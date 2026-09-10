import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MAX_RESPONSE_BYTES, overLimit, headerLength, readCapped } from '../src/http.js'

const src = readFileSync(fileURLToPath(new URL('../src/http.ts', import.meta.url)), 'utf8')

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

describe('readCapped', () => {
  const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c)
        controller.close()
      },
    })

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

// Exercising the real node:https path would require a live or local server, outside this
// project's testing convention (see bluesky-timeout.test.ts) -- so slowGet's own wiring is
// asserted from its source text instead.
describe('slowGet request size guard (source text)', () => {
  const slowGetBody = src.slice(src.indexOf('export const slowGet'))
  const dataIdx = slowGetBody.indexOf("res.on('data'")

  it('checks content-length via headerLength, and rejects, before any body listener is registered', () => {
    const beforeBody = slowGetBody.slice(0, dataIdx)
    assert.match(beforeBody, /headerLength\(res\.headers\['content-length'\]\)/)
    assert.match(beforeBody, /overLimit\(declared, MAX_RESPONSE_BYTES\)/)
    assert.match(beforeBody, /res\.destroy\(\)/)
    assert.match(beforeBody, /fail\(/, 'an over-limit declared length must reject, not resolve')
    assert.doesNotMatch(beforeBody, /resolve\(/, 'the declared-length check must never resolve')
  })

  it('stops accumulating once the running total exceeds MAX_RESPONSE_BYTES while streaming, never resolving a partial body', () => {
    const dataHandler = slowGetBody.slice(dataIdx, slowGetBody.indexOf("res.on('end'"))
    assert.match(dataHandler, /total \+= c\.length/)
    assert.match(dataHandler, /overLimit\(total, MAX_RESPONSE_BYTES\)/)
    assert.match(dataHandler, /res\.destroy\(\)/)
    assert.match(dataHandler, /fail\(/)
    // the resolve only happens on 'end', which the oversize branch above returns out of via
    // fail() before ever reaching -- so an oversize response can never resolve at all.
    const endHandler = slowGetBody.slice(slowGetBody.indexOf("res.on('end'"))
    assert.match(endHandler, /if \(settled\) return/, 'end must no-op once fail() already settled the promise')
  })
})
