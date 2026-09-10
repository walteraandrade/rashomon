import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { headerLength, MAX_RESPONSE_BYTES, overLimit } from '../src/http.js'
import { db, migrate } from '../src/db.js'
import { download, gkg, MAX_EXPANDED_BYTES, unzipBounded } from '../src/collectors/gkg.js'
import { fetchFeed } from '../src/collectors/rss.js'
import { docsText } from './docs.js'
import './close.js'

// Independent, verifier-authored acceptance suite for issue #113. Written from the approved
// spec's acceptance criteria, not from the build's own test/bound-download-acceptance.test.ts
// (which this suite deliberately does not import from or lean on).

const repoFile = (relPath: string) => readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8')

const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })

describe('AC1: src/http.ts exports MAX_RESPONSE_BYTES equal to 32 * 1024 * 1024', () => {
  it('AC1: MAX_RESPONSE_BYTES is exactly 32 MB', () => {
    assert.equal(MAX_RESPONSE_BYTES, 33554432)
    assert.equal(MAX_RESPONSE_BYTES, 32 * 1024 * 1024)
  })
})

// Exercising the real node:https socket path would need a live or local TLS server, which is
// outside this project's testing convention (see test/bluesky-timeout.test.ts) -- so slowGet's
// wiring is checked against its own source text, same convention, independently written.
describe('AC2: slowGet rejects an over-limit declared content-length before reading any body', () => {
  const src = repoFile('src/http.ts')
  const slowGetSrc = src.slice(src.indexOf('export const slowGet'))
  const preBodyListeners = slowGetSrc.slice(0, slowGetSrc.indexOf("res.on('data'"))

  it('AC2: reads content-length via headerLength and compares it with overLimit before any res.on listener is attached', () => {
    assert.match(preBodyListeners, /headerLength\(res\.headers\[.content-length.\]\)/)
    assert.match(preBodyListeners, /overLimit\([^)]*MAX_RESPONSE_BYTES\)/)
  })

  it('AC2: an over-limit declared length destroys the response and rejects, it does not resolve', () => {
    assert.match(preBodyListeners, /res\.destroy\(\)/)
    assert.match(preBodyListeners, /reject|fail\(/)
    assert.doesNotMatch(preBodyListeners, /resolve\(/)
  })
})

describe('AC3: slowGet rejects on an accumulated over-limit body and never resolves a partial one', () => {
  const src = repoFile('src/http.ts')
  const slowGetSrc = src.slice(src.indexOf('export const slowGet'))
  const dataListener = slowGetSrc.slice(slowGetSrc.indexOf("res.on('data'"), slowGetSrc.indexOf("res.on('error'"))
  const endListener = slowGetSrc.slice(slowGetSrc.indexOf("res.on('end'"))

  it('AC3: the data handler keeps a running total and checks it with overLimit against MAX_RESPONSE_BYTES', () => {
    assert.match(dataListener, /total \+= c\.length/)
    assert.match(dataListener, /overLimit\(total, MAX_RESPONSE_BYTES\)/)
  })

  it('AC3: crossing the limit destroys the response instead of buffering further', () => {
    assert.match(dataListener, /res\.destroy\(\)/)
  })

  it('AC3: end only resolves once, and only if nothing already rejected -- so an oversize response can never resolve at all, partial or otherwise', () => {
    assert.match(endListener, /if \(settled\) return/)
  })
})

describe('AC4: the byte-over-limit decision is a pure, network-free, directly callable unit', () => {
  it('AC4: overLimit is a plain function of two numbers, no socket or fetch involved', () => {
    assert.equal(typeof overLimit, 'function')
    assert.equal(overLimit(0, 10), false)
    assert.equal(overLimit(10, 10), false)
    assert.equal(overLimit(11, 10), true)
  })

  it('AC4: never trips under MAX_RESPONSE_BYTES, does not trip exactly at it, trips one byte over', () => {
    assert.equal(overLimit(MAX_RESPONSE_BYTES - 1, MAX_RESPONSE_BYTES), false)
    assert.equal(overLimit(MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES), false)
    assert.equal(overLimit(MAX_RESPONSE_BYTES + 1, MAX_RESPONSE_BYTES), true)
  })

  it('AC4: a call after tripping still reports over -- the decision carries no hidden state to reset', () => {
    assert.equal(overLimit(1000, 100), true)
    assert.equal(overLimit(1000, 100), true)
  })
})

describe('AC5: gkg.ts download checks the zip content-length before touching the body', () => {
  it('AC5: an over-limit declared content-length resolves oversize/compressed and res.body/arrayBuffer are never accessed', async () => {
    let touched = false
    const declared = MAX_RESPONSE_BYTES + 12345
    const res = {
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k === 'content-length' ? String(declared) : null) },
      get body() {
        touched = true
        return null
      },
      async arrayBuffer() {
        touched = true
        return new ArrayBuffer(0)
      },
    }
    const fetchImpl = (async () => res) as unknown as typeof fetch
    const result = await download('20260910000000', fetchImpl)
    assert.deepEqual(result, { status: 'oversize', stage: 'compressed', bytes: declared, limit: MAX_RESPONSE_BYTES })
    assert.equal(touched, false)
  })

  it('AC5: an under-limit declared content-length still reads the body and downloads normally', async () => {
    const csv = 'a\tb\tc\n'
    const zip = zipSync({ 'entry.csv': strToU8(csv) })
    const res = {
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k === 'content-length' ? String(zip.length) : null) },
      body: streamOf([zip]),
    }
    const fetchImpl = (async () => res) as unknown as typeof fetch
    assert.deepEqual(await download('20260910000000', fetchImpl), { status: 'ok', csv })
  })
})

describe('AC6: gkg.ts decompression is bounded by MAX_EXPANDED_BYTES, exercised by a network-free unit', () => {
  it('AC6: MAX_EXPANDED_BYTES is exactly 256 * 1024 * 1024', () => {
    assert.equal(MAX_EXPANDED_BYTES, 268435456)
    assert.equal(MAX_EXPANDED_BYTES, 256 * 1024 * 1024)
  })

  it('AC6: unzipBounded resolves ok with the exact decoded text for a payload under the limit', async () => {
    const csv = 'domain\turl\ttitle\nfoo.com\thttps://foo.com/x\tHello\n'
    const zip = zipSync({ 'file.csv': strToU8(csv) })
    const result = await unzipBounded(zip)
    assert.deepEqual(result, { status: 'ok', csv })
  })

  it('AC6: unzipBounded resolves oversize/expanded, and never throws, when a small injected limit is crossed', async () => {
    const csv = 'w'.repeat(10_000)
    const zip = zipSync({ 'file.csv': strToU8(csv) })
    let threw = false
    let result: Awaited<ReturnType<typeof unzipBounded>> | undefined
    try {
      result = await unzipBounded(zip, 100)
    } catch {
      threw = true
    }
    assert.equal(threw, false)
    assert.equal(result?.status, 'oversize')
    if (result?.status === 'oversize') {
      assert.equal(result.stage, 'expanded')
      assert.equal(result.limit, 100)
      assert.ok(result.bytes > 100)
    }
  })

  // A decompression-bomb shape (many zeros) compresses to almost nothing, so a naive
  // "decompress fully, then compare byte count to the limit" implementation would still
  // report the correct final size while having briefly held the whole expansion in memory.
  // This proves the bound is enforced while streaming: the reported byte count, and thus the
  // amount ever materialized, stays far below the true uncompressed size.
  it('AC6: a decompression-bomb-shaped entry is stopped mid-stream, nowhere near its true uncompressed size', async () => {
    // All-zero input compresses at roughly 1024:1, so this 300 MB entry is only ~300 KB
    // compressed -- several 64 KB push() slices. A naive "inflate the whole push, then compare
    // to the limit" implementation stops only between slices, so the true test of streaming
    // enforcement is that the cutoff stays a small fraction of the true size, not the whole
    // multi-slice input.
    const trueSize = 300 * 1024 * 1024
    const zip = zipSync({ 'bomb.csv': new Uint8Array(trueSize) })
    const result = await unzipBounded(zip, 2000)
    assert.equal(result.status, 'oversize')
    if (result.status === 'oversize') {
      assert.equal(result.stage, 'expanded')
      assert.ok(result.bytes < trueSize / 3, `expected the stream to be cut well short of ${trueSize}, got ${result.bytes}`)
    }
  })
})

describe('AC7: a 404 slot resolves missing, and an empty zip resolves ok with an empty csv, unchanged from today', () => {
  it('AC7: 404 maps to { status: "missing" }', async () => {
    const fetchImpl = (async () => ({ status: 404, ok: false, headers: { get: () => null } })) as unknown as typeof fetch
    assert.deepEqual(await download('20260910000000', fetchImpl), { status: 'missing' })
  })

  it('AC7: an empty zip (no entries) resolves { status: "ok", csv: "" } via download', async () => {
    const res = { status: 200, ok: true, headers: { get: () => null }, body: streamOf([zipSync({})]) }
    const fetchImpl = (async () => res) as unknown as typeof fetch
    assert.deepEqual(await download('20260910000000', fetchImpl), { status: 'ok', csv: '' })
  })

  it('AC7: an empty zip resolves { status: "ok", csv: "" } via unzipBounded directly', async () => {
    assert.deepEqual(await unzipBounded(zipSync({})), { status: 'ok', csv: '' })
  })
})

describe('AC8 & AC9: gkg() skips an oversize slot without marking gkg_files, and still returns docs from the rest', () => {
  before(migrate)

  const latest = '20260910123000'
  const oversizeSlot = '20260910121500'
  const okSlotA = '20260910110000'
  const okSlotB = '20260910093000'

  const gkgRow = (slot: string) => {
    const cols = new Array(27).fill('')
    cols[3] = 'verifier.example'
    cols[4] = `https://verifier.example/${slot}`
    cols[7] = ''
    cols[11] = ''
    cols[15] = '2.5'
    cols[25] = 'srclc:por'
    cols[26] = `<PAGE_TITLE>Verifier doc ${slot}</PAGE_TITLE>`
    return cols.join('\t')
  }

  const originalFetch = globalThis.fetch
  before(() => {
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url)
      if (u.endsWith('lastupdate-translation.txt')) {
        return { text: async () => `${latest}.translation.gkg.csv.zip` } as Response
      }
      const m = u.match(/\/(\d{14})\.translation\.gkg\.csv\.zip$/)
      const slot = m ? m[1] : ''
      if (slot === oversizeSlot) {
        return {
          status: 200,
          ok: true,
          headers: { get: (k: string) => (k === 'content-length' ? String(MAX_RESPONSE_BYTES + 1) : null) },
          body: null,
        } as unknown as Response
      }
      const zip = zipSync({ 'entry.csv': strToU8(gkgRow(slot)) })
      return { status: 200, ok: true, headers: { get: () => null }, body: streamOf([zip]) } as unknown as Response
    }) as unknown as typeof fetch
  })
  after(() => {
    globalThis.fetch = originalFetch
  })

  let docs: Awaited<ReturnType<typeof gkg>>

  it('AC9: gkg() completes without throwing even though one pending slot resolves oversize', async () => {
    docs = await gkg([])
    assert.ok(Array.isArray(docs))
  })

  it('AC9: docs from both ok slots are present; the oversize slot contributes nothing', () => {
    assert.ok(docs.some((d) => d.uri === `https://verifier.example/${okSlotA}`))
    assert.ok(docs.some((d) => d.uri === `https://verifier.example/${okSlotB}`))
    assert.ok(!docs.some((d) => d.uri.includes(oversizeSlot)))
  })

  it('AC8: the oversize slot is not recorded in gkg_files', async () => {
    const rows = (await db.query(`select 1 from gkg_files where slot = $1`, [oversizeSlot])).rows
    assert.equal(rows.length, 0)
  })

  it('AC8: the ok slots are each recorded in gkg_files exactly once', async () => {
    for (const slot of [okSlotA, okSlotB]) {
      const rows = (await db.query(`select 1 from gkg_files where slot = $1`, [slot])).rows
      assert.equal(rows.length, 1)
    }
  })
})

describe('AC10: rss.ts fetchFeed caps against the shared MAX_RESPONSE_BYTES before res.arrayBuffer()', () => {
  const rssSrc = repoFile('src/collectors/rss.ts')

  it('AC10: imports MAX_RESPONSE_BYTES from http.ts and does not redeclare its own literal', () => {
    assert.match(rssSrc, /import\s*\{[^}]*\bMAX_RESPONSE_BYTES\b[^}]*\}\s*from\s*'\.\.\/http\.js'/)
    assert.doesNotMatch(rssSrc, /const\s+MAX_RESPONSE_BYTES\s*=/)
  })

  it('AC10: checks content-length before consuming the body', () => {
    const clIdx = rssSrc.search(/headerLength\(res\.headers/)
    const arrayBufferIdx = rssSrc.indexOf('res.arrayBuffer()')
    assert.ok(clIdx > -1)
    if (arrayBufferIdx > -1) assert.ok(clIdx < arrayBufferIdx)
  })

  const originalFetch = globalThis.fetch
  after(() => {
    globalThis.fetch = originalFetch
  })

  it('AC10: an over-limit declared content-length rejects fetchFeed without ever touching the body', async () => {
    let touched = false
    globalThis.fetch = (async () => ({
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k === 'content-length' ? String(MAX_RESPONSE_BYTES + 1) : null) },
      get body() {
        touched = true
        return null
      },
    })) as unknown as typeof fetch
    await assert.rejects(fetchFeed('rss')('https://verifier.example/feed'))
    assert.equal(touched, false)
  })

  it('AC10: a streamed body over the limit with no declared content-length also rejects', async () => {
    const chunk = new Uint8Array(MAX_RESPONSE_BYTES)
    globalThis.fetch = (async () => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      body: streamOf([chunk, new Uint8Array([9])]),
    })) as unknown as typeof fetch
    await assert.rejects(fetchFeed('rss')('https://verifier.example/feed'))
  })

  it('AC10: a normal feed under the limit still parses into docs', async () => {
    const xml = '<rss><channel><item><link>https://verifier.example/1</link><title>Nome fala hoje</title></item></channel></rss>'
    globalThis.fetch = (async () => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      body: streamOf([new TextEncoder().encode(xml)]),
    })) as unknown as typeof fetch
    const docs = await fetchFeed('rss')('https://verifier.example/feed')
    assert.equal(docs.length, 1)
    assert.equal(docs[0].uri, 'https://verifier.example/1')
  })
})

describe('AC12: the docs state both size ceilings and the skip-without-marking-done retry fact', () => {
  it('AC12: 32 MB is documented somewhere in README.md/docs/*.md', () => {
    assert.match(docsText, /32\s*MB/)
  })

  it('AC12: 256 MB is documented somewhere in README.md/docs/*.md', () => {
    assert.match(docsText, /256\s*MB/)
  })

  it('AC12: an oversize GKG slot is documented as skipped without being marked done in gkg_files, so a later run retries it', () => {
    assert.match(docsText, /gkg_files/)
    assert.match(docsText, /(without being marked done|not marked done)/i)
    assert.match(docsText, /retr(y|ies|ied)/i)
  })
})
