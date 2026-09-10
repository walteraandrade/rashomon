import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Collectors are integration code and never run against the network in tests, so this
// reads the source: every fetch in the bluesky collector must carry an abort timeout,
// otherwise a silent connection holds the whole ingest run until the job timeout.
describe('bluesky collector request timeouts', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/collectors/bluesky.ts', import.meta.url)), 'utf8')
  // Each call runs up to the `if (!res.ok)` check that follows it; a lazy `})` match
  // would stop early at JSON.stringify({ ... }) inside the login body.
  const fetchCalls = src.match(/await fetch\([\s\S]*?(?=\n\s*if \(!res\.ok\))/g) ?? []

  it('has two fetch calls, login and search', () => {
    assert.equal(fetchCalls.length, 2)
  })

  it('passes AbortSignal.timeout to each of them', () => {
    for (const call of fetchCalls) assert.match(call, /signal: AbortSignal\.timeout\(requestTimeoutMs\)/)
  })

  it('uses the same 45 s ceiling as slowGet', () => {
    assert.match(src, /const requestTimeoutMs = 45_000/)
  })
})
