import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fetchFeed } from '../src/collectors/rss.js'
import { MAX_RESPONSE_BYTES } from '../src/http.js'

const rssSrc = readFileSync(fileURLToPath(new URL('../src/collectors/rss.ts', import.meta.url)), 'utf8')

// The same convention as test/api.test.ts and press-collectors-acceptance.test.ts: stub
// global fetch and restore it afterward, so this never hits the network (CLAUDE.md).
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })

const stubFetch = (res: { status?: number; ok?: boolean; contentLength?: string | null; body?: ReadableStream<Uint8Array> | null }) => {
  let bodyAccessed = false
  globalThis.fetch = (async () => ({
    status: res.status ?? 200,
    ok: res.ok ?? true,
    headers: { get: (k: string) => (k === 'content-length' ? res.contentLength ?? null : null) },
    get body() {
      bodyAccessed = true
      return res.body ?? null
    },
  })) as unknown as typeof fetch
  return () => bodyAccessed
}

describe('fetchFeed — imports and reuses http.ts\'s shared ceiling (source text)', () => {
  it('imports MAX_RESPONSE_BYTES from ../http.js rather than re-declaring a literal', () => {
    assert.match(rssSrc, /import\s*\{[^}]*MAX_RESPONSE_BYTES[^}]*\}\s*from\s*'\.\.\/http\.js'/)
    assert.doesNotMatch(rssSrc, /const\s+MAX_RESPONSE_BYTES/, 'must reuse the shared constant, not redeclare it')
  })

  it('checks content-length before res.arrayBuffer()/reading the body', () => {
    const clIdx = rssSrc.indexOf('headerLength(res.headers')
    const arrayBufferIdx = rssSrc.indexOf('res.arrayBuffer()')
    const readCappedIdx = rssSrc.indexOf('readCapped(res.body')
    assert.ok(clIdx > -1, 'fetchFeed must check content-length')
    assert.equal(arrayBufferIdx, -1, 'fetchFeed must no longer call res.arrayBuffer() directly')
    assert.ok(readCappedIdx > -1 && clIdx < readCappedIdx, 'content-length check must precede the capped body read')
  })
})

describe('fetchFeed — behaviour, driven through a stubbed global fetch', () => {
  const feedXml = '<rss><channel><item><link>https://x/1</link><title>Fulano fala</title></item></channel></rss>'

  it('parses a feed under the cap', async () => {
    stubFetch({ body: streamOf([new TextEncoder().encode(feedXml)]) })
    const docs = await fetchFeed('rss')('https://example.org/feed')
    assert.equal(docs.length, 1)
    assert.equal(docs[0].uri, 'https://x/1')
  })

  it('rejects a declared content-length over MAX_RESPONSE_BYTES without reading the body', async () => {
    const wasBodyAccessed = stubFetch({ contentLength: String(MAX_RESPONSE_BYTES + 1) })
    await assert.rejects(fetchFeed('rss')('https://example.org/feed'), /too large/)
    assert.equal(wasBodyAccessed(), false)
  })

  it('rejects once the streamed body exceeds MAX_RESPONSE_BYTES with no declared length', async () => {
    const chunk = new Uint8Array(MAX_RESPONSE_BYTES)
    stubFetch({ body: streamOf([chunk, new Uint8Array([1])]) })
    await assert.rejects(fetchFeed('rss')('https://example.org/feed'), /too large/)
  })

  it('still throws on a non-ok status, unchanged from today', async () => {
    stubFetch({ status: 500, ok: false })
    await assert.rejects(fetchFeed('rss')('https://example.org/feed'), /rss https:\/\/example\.org\/feed 500/)
  })
})
