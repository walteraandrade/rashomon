import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SCOPE_LIMIT, SCOPE_TTL_MS, clearScopes, debounce, fromScope, readScope, writeScope } from '../src/ui/state.js'

// src/ui/state.ts: the page-wide scope memo and debounce. Everything per-figure lives inside
// that figure's own mount(), so nothing else is here.

describe('issue #43 AC2: the memo is bounded, short-lived and never caches a failure', () => {
  it('serves a fresh entry without calling the fetcher again', async () => {
    clearScopes()
    let calls = 0
    const fetcher = async () => {
      calls++
      return { rows: calls }
    }
    assert.deepEqual(await fromScope('sources', 'k', fetcher), { rows: 1 })
    assert.deepEqual(await fromScope('sources', 'k', fetcher), { rows: 1 })
    assert.equal(calls, 1)
  })

  it('a rejection leaves the bucket untouched, so the next attempt is a real attempt', async () => {
    clearScopes()
    let calls = 0
    await assert.rejects(
      fromScope('graph', 'k', async () => {
        calls++
        throw new Error('HTTP 500')
      }),
    )
    assert.equal(readScope('graph', 'k'), null, 'a failed response must never become a hit')
    await assert.rejects(
      fromScope('graph', 'k', async () => {
        calls++
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      }),
    )
    assert.equal(calls, 2, 'the retry must reach the network')
    assert.equal(readScope('graph', 'k'), null, 'an abort must never become a hit either')
  })

  it('expires an entry once it is older than the TTL', () => {
    clearScopes()
    writeScope('docs', 'k', { docs: [] }, 1_000)
    assert.ok(readScope('docs', 'k', 1_000 + SCOPE_TTL_MS), 'still fresh at the boundary')
    assert.equal(readScope('docs', 'k', 1_001 + SCOPE_TTL_MS), null, 'stale one millisecond later')
  })

  it('evicts the oldest write once the bucket is full, so a long session cannot grow it', () => {
    clearScopes()
    for (let i = 0; i <= SCOPE_LIMIT; i++) writeScope('graph', `k${i}`, i)
    assert.equal(readScope('graph', 'k0'), null, 'the oldest key is the one that goes')
    assert.deepEqual(readScope('graph', `k${SCOPE_LIMIT}`), { value: SCOPE_LIMIT })
  })

  it('distinguishes a cached null from nothing cached', () => {
    clearScopes()
    writeScope('docs', 'k', null)
    assert.deepEqual(readScope('docs', 'k'), { value: null })
    assert.equal(readScope('docs', 'missing'), null)
  })
})

describe('debounce', () => {
  it('debounce collapses a burst into one trailing call', async () => {
    let calls = 0
    const run = debounce(() => calls++, 10)
    run()
    run()
    run()
    assert.equal(calls, 0, 'nothing fires on the leading edge')
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(calls, 1, 'a burst of control changes costs one load, not three')
    run()
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(calls, 2, 'a later change still loads')
  })
})
