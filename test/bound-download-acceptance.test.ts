import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

const repoFile = (relPath: string) => readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8')

const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })

describe('AC1: src/http.ts exports MAX_RESPONSE_BYTES = 32 MB', () => {
  it('AC1: MAX_RESPONSE_BYTES is 32 * 1024 * 1024', () => {
    assert.equal(MAX_RESPONSE_BYTES, 32 * 1024 * 1024)
  })
})

describe('AC2 & AC3: slowGet is guarded before and while reading the body', () => {
  const src = repoFile('src/http.ts')
  const slowGetBody = src.slice(src.indexOf('export const slowGet'))
  const dataIdx = slowGetBody.indexOf("res.on('data'")

  it('AC2: the declared content-length is checked, and rejected, before any body listener is registered', () => {
    const beforeBody = slowGetBody.slice(0, dataIdx)
    assert.match(beforeBody, /headerLength\(res\.headers\['content-length'\]\)/, 'must read content-length via the shared headerLength helper')
    assert.match(beforeBody, /overLimit\(declared, MAX_RESPONSE_BYTES\)/, 'must compare it against MAX_RESPONSE_BYTES via the shared overLimit decision')
    assert.match(beforeBody, /res\.destroy\(\)/)
    assert.match(beforeBody, /fail\(/, 'an over-limit declared length must reject, not resolve')
  })

  it('AC3: the streaming handler keeps a running total and rejects once it crosses the limit, never resolving a partial body', () => {
    const dataHandler = slowGetBody.slice(dataIdx, slowGetBody.indexOf("res.on('end'"))
    assert.match(dataHandler, /total \+= c\.length/, 'must accumulate the running total as chunks arrive')
    assert.match(dataHandler, /overLimit\(total, MAX_RESPONSE_BYTES\)/)
    assert.match(dataHandler, /res\.destroy\(\)/)
    assert.match(dataHandler, /fail\(/)
    // the resolve only happens on 'end', which the oversize branch above returns out of via
    // fail() before ever reaching -- so an oversize response can never resolve at all.
    const endHandler = slowGetBody.slice(slowGetBody.indexOf("res.on('end'"))
    assert.match(endHandler, /if \(settled\) return/, 'end must no-op once fail() already settled the promise')
  })
})

describe('AC4: the byte-over-limit decision is a pure, network-free unit', () => {
  it('AC4: overLimit is callable directly with synthetic numbers, independent of any limit value', () => {
    assert.equal(overLimit(99, 100), false)
    assert.equal(overLimit(100, 100), false)
    assert.equal(overLimit(101, 100), true)
  })

  it('AC4: overLimit never trips under MAX_RESPONSE_BYTES, not at it, and trips one byte over', () => {
    assert.equal(overLimit(MAX_RESPONSE_BYTES - 1, MAX_RESPONSE_BYTES), false)
    assert.equal(overLimit(MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES), false)
    assert.equal(overLimit(MAX_RESPONSE_BYTES + 1, MAX_RESPONSE_BYTES), true)
  })

  it('AC4: a second call after tripping still reports over -- no silent internal reset', () => {
    assert.equal(overLimit(MAX_RESPONSE_BYTES + 1, MAX_RESPONSE_BYTES), true)
    assert.equal(overLimit(MAX_RESPONSE_BYTES + 5, MAX_RESPONSE_BYTES), true)
  })
})

describe('AC5: gkg.ts checks content-length before touching the zip body', () => {
  it('AC5: an over-limit declared content-length resolves oversize/compressed without ever reading the stream', async () => {
    let bodyTouched = false
    const declared = MAX_RESPONSE_BYTES + 1
    const res = {
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k === 'content-length' ? String(declared) : null) },
      get body() {
        bodyTouched = true
        return null
      },
      async arrayBuffer() {
        bodyTouched = true
        return new ArrayBuffer(0)
      },
    }
    const fetchImpl = (async () => res) as unknown as typeof fetch
    const result = await download('20260910120000', fetchImpl)
    assert.deepEqual(result, { status: 'oversize', stage: 'compressed', bytes: declared, limit: MAX_RESPONSE_BYTES })
    assert.equal(bodyTouched, false, 'download must never read res.body/arrayBuffer() once the declared length is over the ceiling')
  })
})

describe('AC6: decompression is bounded by MAX_EXPANDED_BYTES via a network-free, fflate-driven unit', () => {
  it('AC6: MAX_EXPANDED_BYTES is 256 * 1024 * 1024', () => {
    assert.equal(MAX_EXPANDED_BYTES, 256 * 1024 * 1024)
  })

  it('AC6: a payload under the limit resolves ok with the exact decoded text', async () => {
    const csv = 'example.org\thttps://example.org/x\t\t\n'
    const zip = zipSync({ 'entry.csv': strToU8(csv) })
    assert.deepEqual(await unzipBounded(zip), { status: 'ok', csv })
  })

  it('AC6: a payload whose decompressed size crosses a small, test-injected limit resolves oversize/expanded, and never throws', async () => {
    const csv = 'z'.repeat(5000)
    const zip = zipSync({ 'entry.csv': strToU8(csv) })
    const result = await unzipBounded(zip, 50)
    assert.equal(result.status, 'oversize')
    if (result.status === 'oversize') {
      assert.equal(result.stage, 'expanded')
      assert.equal(result.limit, 50)
      assert.ok(result.bytes > 50)
    }
  })
})

describe('AC7: 404 and empty-zip behaviour is unchanged', () => {
  it('AC7: a 404 zip response resolves { status: "missing" }', async () => {
    const fetchImpl = (async () => ({ status: 404, ok: false, headers: { get: () => null } })) as unknown as typeof fetch
    assert.deepEqual(await download('20260910120000', fetchImpl), { status: 'missing' })
  })

  it('AC7: an empty zip (no entries) resolves { status: "ok", csv: "" }', async () => {
    const res = { status: 200, ok: true, headers: { get: () => null }, body: streamOf([zipSync({})]) }
    const fetchImpl = (async () => res) as unknown as typeof fetch
    assert.deepEqual(await download('20260910120000', fetchImpl), { status: 'ok', csv: '' })
  })
})

// AC8 and AC9 are exercised together, functionally, by driving the real gkg() collector end to
// end against a stubbed global fetch: one pending slot resolves oversize (a declared
// content-length above MAX_RESPONSE_BYTES) among several that resolve ok. This proves both
// criteria against the actual gkg_files table, not against gkg.ts's source text: the oversize
// slot never gets a row, the ok slots do, and the whole run completes without throwing.
describe('AC8 & AC9: an oversize slot is skipped without marking gkg_files, and the run finishes anyway', () => {
  before(migrate)

  const base = 'https://data.gdeltproject.org/gdeltv2'
  const latest = '20260910120000'
  const oversizeSlot = '20260910114500'
  const okSlot = '20260910113000'

  const gkgRow = (slot: string) => {
    const cols = new Array(27).fill('')
    cols[3] = 'example.org'
    cols[4] = `https://example.org/${slot}`
    cols[15] = '1.0'
    cols[25] = 'srclc:por'
    cols[26] = `<PAGE_TITLE>Doc ${slot}</PAGE_TITLE>`
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

  it('AC9: gkg() resolves without throwing and includes a doc from an ok slot even though one slot is oversize', async () => {
    const docs = await gkg([])
    assert.ok(docs.some((d) => d.uri === `https://example.org/${okSlot}`), 'the ok slot must still produce a doc')
    assert.ok(!docs.some((d) => d.uri.includes(oversizeSlot)), 'the oversize slot must never produce a doc')
  })

  it('AC8: the oversize slot gets no gkg_files row; the ok slot does', async () => {
    const oversizeRows = (await db.query(`select 1 from gkg_files where slot = $1`, [oversizeSlot])).rows
    assert.equal(oversizeRows.length, 0, 'an oversize slot must never be inserted into gkg_files')
    const okRows = (await db.query(`select 1 from gkg_files where slot = $1`, [okSlot])).rows
    assert.equal(okRows.length, 1, 'a successfully parsed slot must be recorded in gkg_files exactly once')
  })
})

describe('AC10: rss.ts caps its feed fetch against the shared MAX_RESPONSE_BYTES', () => {
  const rssSrc = repoFile('src/collectors/rss.ts')

  it('AC10: fetchFeed imports MAX_RESPONSE_BYTES from http.ts rather than declaring its own literal', () => {
    assert.match(rssSrc, /from '\.\.\/http\.js'/)
    assert.match(rssSrc, /\bMAX_RESPONSE_BYTES\b/)
    assert.doesNotMatch(rssSrc, /MAX_RESPONSE_BYTES\s*=\s*\d/, 'must not redeclare the constant with its own literal value')
  })

  it('AC10: the content-length preflight runs before res.arrayBuffer()', () => {
    const arrayBufferIdx = rssSrc.indexOf('res.arrayBuffer()')
    const clIdx = rssSrc.search(/headerLength\(res\.headers/)
    assert.ok(clIdx > -1, 'fetchFeed must check content-length via the shared headerLength helper')
    if (arrayBufferIdx > -1) assert.ok(clIdx < arrayBufferIdx, 'content-length must be checked before res.arrayBuffer()')
  })

  const originalFetch = globalThis.fetch
  const stub = (opts: { contentLength?: string | null; body?: ReadableStream<Uint8Array> | null; status?: number; ok?: boolean }) => {
    let bodyTouched = false
    globalThis.fetch = (async () => ({
      status: opts.status ?? 200,
      ok: opts.ok ?? true,
      headers: { get: (k: string) => (k === 'content-length' ? opts.contentLength ?? null : null) },
      get body() {
        bodyTouched = true
        return opts.body ?? null
      },
    })) as unknown as typeof fetch
    return () => bodyTouched
  }
  after(() => {
    globalThis.fetch = originalFetch
  })

  it('AC10: a declared content-length over the ceiling rejects without reading the body', async () => {
    const touched = stub({ contentLength: String(MAX_RESPONSE_BYTES + 1) })
    await assert.rejects(fetchFeed('rss')('https://example.org/feed'))
    assert.equal(touched(), false)
  })

  it('AC10: a streamed body over the ceiling with no declared content-length rejects too', async () => {
    const chunk = new Uint8Array(MAX_RESPONSE_BYTES)
    stub({ body: streamOf([chunk, new Uint8Array([1])]) })
    await assert.rejects(fetchFeed('rss')('https://example.org/feed'))
  })

  it('AC10: a feed under the ceiling still parses normally', async () => {
    const xml = '<rss><channel><item><link>https://x/1</link><title>Fulano fala</title></item></channel></rss>'
    stub({ body: streamOf([new TextEncoder().encode(xml)]) })
    const docs = await fetchFeed('rss')('https://example.org/feed')
    assert.equal(docs.length, 1)
    assert.equal(docs[0].uri, 'https://x/1')
  })
})

describe('AC11: gdelt.ts, camara.ts, senado.ts are byte-for-byte unchanged from master', () => {
  it('AC11: git diff master -- these three files is empty', () => {
    const diff = execFileSync(
      'git',
      ['diff', 'master', '--', 'src/collectors/gdelt.ts', 'src/collectors/camara.ts', 'src/collectors/senado.ts'],
      { encoding: 'utf8' },
    )
    assert.equal(diff, '', 'this issue must not touch gdelt.ts, camara.ts or senado.ts')
  })
})

describe('AC12: the docs state the two size ceilings and the skip-without-marking-done retry fact', () => {
  it('AC12: 32 MB and 256 MB are both documented', () => {
    assert.match(docsText, /32\s*MB/)
    assert.match(docsText, /256\s*MB/)
  })

  it('AC12: an oversize GKG slot is documented as skipped without being marked done, so a later run retries it', () => {
    assert.match(docsText, /gkg_files/)
    assert.match(docsText, /retr(y|ies|ied)/i)
    assert.match(docsText, /(without being marked done|not.*marked done|skipped)/i)
  })
})
