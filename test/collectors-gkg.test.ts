import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { zipSync, strToU8 } from 'fflate'
import { unzipBounded, download, gkg, MAX_EXPANDED_BYTES } from '../src/collectors/gkg.js'
import { MAX_RESPONSE_BYTES } from '../src/http.js'
import { db, migrate } from '../src/db.js'
import './close.js'

const gkgSrc = readFileSync(fileURLToPath(new URL('../src/collectors/gkg.ts', import.meta.url)), 'utf8')

const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })

describe('unzipBounded — network-free, driven with a zipSync-built archive', () => {
  it('resolves ok with the decoded text for a payload under the limit', async () => {
    const csv = 'domain\turl\ttitle\n'
    const zip = zipSync({ 'entry.csv': strToU8(csv) })
    assert.deepEqual(await unzipBounded(zip), { status: 'ok', csv })
  })

  it('resolves oversize/expanded once decompressed size crosses a small injected limit', async () => {
    const csv = 'x'.repeat(2000)
    const zip = zipSync({ 'entry.csv': strToU8(csv) })
    const result = await unzipBounded(zip, 10)
    assert.equal(result.status, 'oversize')
    if (result.status === 'oversize') {
      assert.equal(result.stage, 'expanded')
      assert.equal(result.limit, 10)
      assert.ok(result.bytes > 10)
    }
  })

  it('never throws on the oversize path', async () => {
    const zip = zipSync({ 'entry.csv': strToU8('y'.repeat(500)) })
    await assert.doesNotReject(unzipBounded(zip, 5))
  })

  it('resolves ok with an empty csv for a zip with no entries', async () => {
    assert.deepEqual(await unzipBounded(zipSync({})), { status: 'ok', csv: '' })
  })

  it('defaults its limit to MAX_EXPANDED_BYTES (128 MB)', () => {
    assert.equal(MAX_EXPANDED_BYTES, 128 * 1024 * 1024)
  })
})

describe('download — driven with an injected fetch implementation, no network', () => {
  it('resolves missing on a 404, unchanged from the old null-for-404 behaviour', async () => {
    const fetchImpl = (async () => ({ status: 404, ok: false, headers: { get: () => null } })) as unknown as typeof fetch
    assert.deepEqual(await download('20260910000000', fetchImpl), { status: 'missing' })
  })

  it('resolves oversize/compressed from a declared content-length, without ever reading the body', async () => {
    let bodyAccessed = false
    const declared = MAX_RESPONSE_BYTES + 1
    const res = {
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k === 'content-length' ? String(declared) : null) },
      get body() {
        bodyAccessed = true
        return null
      },
    }
    const fetchImpl = (async () => res) as unknown as typeof fetch
    const result = await download('20260910000000', fetchImpl)
    assert.deepEqual(result, { status: 'oversize', stage: 'compressed', bytes: declared, limit: MAX_RESPONSE_BYTES })
    assert.equal(bodyAccessed, false)
  })

  it('resolves ok with the decoded csv for a small zip with no declared content-length', async () => {
    const csv = 'domain\turl\ttitle\n'
    const zip = zipSync({ 'entry.csv': strToU8(csv) })
    const res = { status: 200, ok: true, headers: { get: () => null }, body: streamOf([zip]) }
    const fetchImpl = (async () => res) as unknown as typeof fetch
    assert.deepEqual(await download('20260910000000', fetchImpl), { status: 'ok', csv })
  })

  it('resolves ok with an empty csv for an empty zip', async () => {
    const res = { status: 200, ok: true, headers: { get: () => null }, body: streamOf([zipSync({})]) }
    const fetchImpl = (async () => res) as unknown as typeof fetch
    assert.deepEqual(await download('20260910000000', fetchImpl), { status: 'ok', csv: '' })
  })

  it('resolves oversize/compressed once the streamed body exceeds MAX_RESPONSE_BYTES with no declared length', async () => {
    const chunk = new Uint8Array(MAX_RESPONSE_BYTES)
    const res = { status: 200, ok: true, headers: { get: () => null }, body: streamOf([chunk, new Uint8Array([1])]) }
    const fetchImpl = (async () => res) as unknown as typeof fetch
    const result = await download('20260910000000', fetchImpl)
    assert.deepEqual(result, { status: 'oversize', stage: 'compressed', bytes: MAX_RESPONSE_BYTES + 1, limit: MAX_RESPONSE_BYTES })
  })

  it('throws on a non-404 error status, unchanged from today', async () => {
    const fetchImpl = (async () => ({ status: 500, ok: false, headers: { get: () => null } })) as unknown as typeof fetch
    await assert.rejects(download('20260910000000', fetchImpl), /gkg 20260910000000: 500/)
  })
})

// processSlot itself is not exported (it needs the shared db connection, which this transport-layer
// suite otherwise avoids), so its branching is asserted from its source text -- the same convention
// bluesky-timeout.test.ts and press-collectors-acceptance.test.ts use for source-only criteria.
describe('processSlot (source text)', () => {
  const body = gkgSrc.slice(gkgSrc.indexOf('const processSlot'), gkgSrc.indexOf('export const gkg'))

  it('branches on missing, oversize and ok', () => {
    assert.match(body, /result\.status === 'missing'/)
    assert.match(body, /result\.status === 'oversize'/)
  })

  it('the oversize branch returns [] before any gkg_files insert, and logs stage/bytes/limit', () => {
    const oversizeStart = body.indexOf("result.status === 'oversize'")
    const insertStart = body.indexOf('insert into gkg_files')
    assert.ok(oversizeStart > -1 && insertStart > -1)
    assert.ok(oversizeStart < insertStart, 'the oversize check must appear before the gkg_files insert')
    const oversizeBlock = body.slice(oversizeStart, insertStart)
    assert.match(oversizeBlock, /return \[\]/)
    assert.match(oversizeBlock, /result\.stage/)
    assert.match(oversizeBlock, /result\.bytes/)
    assert.match(oversizeBlock, /result\.limit/)
    assert.doesNotMatch(oversizeBlock, /insert into gkg_files/)
  })

  it('the missing branch is unchanged: logs "missing (404)" and returns []', () => {
    const missingLine = body.slice(body.indexOf("result.status === 'missing'"), body.indexOf("result.status === 'oversize'"))
    assert.match(missingLine, /missing \(404\)/)
    assert.match(missingLine, /return.*\[\]|\[\]\)/)
  })
})

// A payload that is not a zip must stay as loud as it was on master, where unzipSync threw
// `invalid zip data`. Resolving it as an empty archive would let processSlot record the slot in
// gkg_files, retiring it on the strength of an answer that carried no documents at all.
describe('unzipBounded rejects bytes that are not an archive', () => {
  it('rejects 1000 junk bytes', async () => {
    const junk = new Uint8Array(1000).map((_, i) => (i * 37) % 256)
    await assert.rejects(unzipBounded(junk), /invalid zip data/)
  })

  it('rejects an HTML error page the CDN answered 200 with', async () => {
    await assert.rejects(unzipBounded(strToU8('<html>503 from the CDN</html>')), /invalid zip data/)
  })

  it('rejects a zero-length body', async () => {
    await assert.rejects(unzipBounded(new Uint8Array(0)), /invalid zip data/)
  })

  it('still resolves an entry-less archive, which carries the end-of-central-directory record', async () => {
    assert.deepEqual(await unzipBounded(zipSync({})), { status: 'ok', csv: '' })
  })
})

describe('gkg() records no slot whose payload carried no documents', () => {
  before(migrate)

  // Slots are processed newest first, and a throw aborts the run the way it does on master, so
  // the ok and entry-less slots are ordered ahead of the junk one to exercise all three.
  const okSlot = '20260911120000'
  const emptyZipSlot = '20260911114500'
  const junkSlot = '20260911113000'
  const latest = okSlot

  const gkgRow = (slot: string) => {
    const cols = new Array(27).fill('')
    cols[3] = 'example.org'
    cols[4] = `https://example.org/${slot}`
    cols[15] = '1.0'
    cols[25] = 'srclc:por'
    cols[26] = `<PAGE_TITLE>Doc ${slot}</PAGE_TITLE>`
    return cols.join('\t')
  }

  const ok = (bytes: Uint8Array) =>
    ({ status: 200, ok: true, headers: { get: () => null }, body: streamOf([bytes]) }) as unknown as Response

  const originalFetch = globalThis.fetch
  const originalSlots = process.env.GKG_SLOTS
  before(() => {
    process.env.GKG_SLOTS = '4'
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url)
      if (u.endsWith('lastupdate-translation.txt')) {
        return { text: async () => `${latest}.translation.gkg.csv.zip` } as Response
      }
      const slot = u.match(/\/(\d{14})\.translation\.gkg\.csv\.zip$/)?.[1] ?? ''
      if (slot === junkSlot) return ok(strToU8('<html>503 from the CDN</html>'))
      if (slot === emptyZipSlot) return ok(zipSync({}))
      return ok(zipSync({ 'entry.csv': strToU8(gkgRow(slot)) }))
    }) as unknown as typeof fetch
  })
  after(() => {
    globalThis.fetch = originalFetch
    if (originalSlots === undefined) delete process.env.GKG_SLOTS
    else process.env.GKG_SLOTS = originalSlots
  })

  it('leaves a non-zip slot and an entry-less slot pending, and still records the ok slot', async () => {
    // The non-zip slot throws and takes the run with it, exactly as unzipSync did on master.
    await assert.rejects(gkg([]), /invalid zip data/)
    for (const slot of [junkSlot, emptyZipSlot]) {
      const rows = (await db.query(`select 1 from gkg_files where slot = $1`, [slot])).rows
      assert.equal(rows.length, 0, `${slot} must stay pending so a later run retries it`)
    }
    const okRows = (await db.query(`select 1 from gkg_files where slot = $1`, [okSlot])).rows
    assert.equal(okRows.length, 1, 'a slot that really parsed must be recorded exactly once')
  })
})
