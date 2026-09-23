import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { zipSync, strToU8 } from 'fflate'
import { Cause, Effect, Exit } from 'effect'
import { TestConsole } from 'effect/testing'
import { collect, download, GKG_DOWNLOAD_TIMEOUT_MS, latestSlot, unzipBounded, MAX_EXPANDED_BYTES } from '../src/collectors/gkg.js'
import { MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS } from '../src/http.js'
import { db, migrate } from '../src/db.js'
import { drain, fakeFetch, failureOf, hanging, runTest, type Call } from './effect.js'
import './close.js'

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

  // A decompression-bomb shape: 300 MB of zeros compresses down to a few hundred KB, so
  // `bytes > limit` alone (the test above) passes even if the whole payload gets decompressed
  // before the stop check ever runs -- which is exactly what unzipBounded used to do. Feeding
  // the compressed input across several small pushes means the stop flag can act between them,
  // so a genuine bound caps the reported bytes at roughly one push's worth of expansion, nowhere
  // near the full 300 MB.
  it('never decompresses a bomb shape past roughly one push worth of output', async () => {
    const trueSize = 300 * 1024 * 1024
    const zip = zipSync({ 'bomb.csv': new Uint8Array(trueSize) })
    const result = await unzipBounded(zip, 2000)
    assert.equal(result.status, 'oversize')
    if (result.status === 'oversize') {
      assert.equal(result.stage, 'expanded')
      assert.ok(result.bytes < trueSize / 3, `expected well under a third of ${trueSize} bytes decompressed, got ${result.bytes}`)
    }
  })

  it('resolves ok with an empty csv for a zip with no entries', async () => {
    assert.deepEqual(await unzipBounded(zipSync({})), { status: 'ok', csv: '' })
  })

  it('defaults its limit to MAX_EXPANDED_BYTES (128 MB)', () => {
    assert.equal(MAX_EXPANDED_BYTES, 128 * 1024 * 1024)
  })

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

const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })

describe('download — driven through a stub FetchHttpClient.Fetch, no network and no fetchImpl parameter', () => {
  const slot = '20260910000000'

  it('resolves missing on a 404, unchanged from before', async () => {
    const fetchFn = fakeFetch(() => new Response(null, { status: 404 }))
    const exit = await runTest(download(slot), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.deepEqual(exit.value, { status: 'missing' })
  })

  it('resolves oversize/compressed from a declared content-length, without ever reading the body', async () => {
    const declared = MAX_RESPONSE_BYTES + 1
    let read = false
    const stream = new ReadableStream<Uint8Array>({ pull: () => void (read = true) }, { highWaterMark: 0 })
    const fetchFn = fakeFetch(() => new Response(stream, { status: 200, headers: { 'content-length': String(declared) } }))
    const exit = await runTest(download(slot), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.deepEqual(exit.value, { status: 'oversize', stage: 'compressed', bytes: declared, limit: MAX_RESPONSE_BYTES })
    assert.equal(read, false)
  })

  it('resolves ok with the decoded csv for a small zip with no declared content-length', async () => {
    const csv = 'domain\turl\ttitle\n'
    const zip = zipSync({ 'entry.csv': strToU8(csv) })
    const fetchFn = fakeFetch(() => new Response(streamOf([zip]), { status: 200 }))
    const exit = await runTest(download(slot), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.deepEqual(exit.value, { status: 'ok', csv })
  })

  it('resolves ok with an empty csv for an empty zip', async () => {
    const fetchFn = fakeFetch(() => new Response(streamOf([zipSync({})]), { status: 200 }))
    const exit = await runTest(download(slot), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.deepEqual(exit.value, { status: 'ok', csv: '' })
  })

  it('resolves oversize/compressed once the streamed body exceeds MAX_RESPONSE_BYTES with no declared length', async () => {
    const chunk = new Uint8Array(MAX_RESPONSE_BYTES)
    const fetchFn = fakeFetch(() => new Response(streamOf([chunk, new Uint8Array([1])]), { status: 200 }))
    const exit = await runTest(download(slot), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.deepEqual(exit.value, { status: 'oversize', stage: 'compressed', bytes: MAX_RESPONSE_BYTES + 1, limit: MAX_RESPONSE_BYTES })
  })

  it('fails on a non-404 error status, unchanged from before', async () => {
    const fetchFn = fakeFetch(() => new Response('boom', { status: 500 }))
    const error = failureOf(await runTest(download(slot), fetchFn))
    assert.match(String(error), /gkg 20260910000000: 500/)
  })
})

describe('two distinct timeouts: latestSlot on REQUEST_TIMEOUT_MS, download on GKG_DOWNLOAD_TIMEOUT_MS', () => {
  it('a latestSlot request that never resolves is cut at REQUEST_TIMEOUT_MS', async () => {
    const fetchFn = fakeFetch(hanging)
    const exit = await runTest(drain(latestSlot, REQUEST_TIMEOUT_MS), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.equal(exit.value.elapsedMs, REQUEST_TIMEOUT_MS)
    assert.equal(fetchFn.calls[0].signal.aborted, true)
  })

  it('a download request that never resolves is cut at GKG_DOWNLOAD_TIMEOUT_MS, distinct from REQUEST_TIMEOUT_MS', async () => {
    assert.notEqual(GKG_DOWNLOAD_TIMEOUT_MS, REQUEST_TIMEOUT_MS)
    assert.equal(GKG_DOWNLOAD_TIMEOUT_MS, 300_000)
    const fetchFn = fakeFetch(hanging)
    const exit = await runTest(drain(download('20260910000000'), GKG_DOWNLOAD_TIMEOUT_MS), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.equal(exit.value.elapsedMs, GKG_DOWNLOAD_TIMEOUT_MS)
    assert.equal(fetchFn.calls[0].signal.aborted, true)
  })
})

describe('latestSlot', () => {
  it('fails with "gkg: cannot read lastupdate-translation.txt" when the body carries no matching slot pattern', async () => {
    const fetchFn = fakeFetch(() => new Response('not a slot pattern', { status: 200 }))
    const error = failureOf(await runTest(latestSlot, fetchFn))
    assert.match(String(error), /gkg: cannot read lastupdate-translation\.txt/)
  })
})

const gkgRow = (slot: string, extra: Partial<Record<'domain' | 'themes', string>> = {}) => {
  const cols = new Array(27).fill('')
  cols[3] = extra.domain ?? 'example.org'
  cols[4] = `https://example.org/${slot}`
  cols[7] = extra.themes ?? ''
  cols[15] = '1.0'
  cols[25] = 'srclc:por'
  cols[26] = `<PAGE_TITLE>Doc ${slot}</PAGE_TITLE>`
  return cols.join('\t')
}

const gkgFetch = (latest: string, bySlot: (slot: string) => Response) =>
  fakeFetch((c: Call) => {
    if (c.url.pathname.endsWith('lastupdate-translation.txt')) return new Response(`${latest}.translation.gkg.csv.zip`, { status: 200 })
    const slot = c.url.pathname.match(/\/(\d{14})\.translation\.gkg\.csv\.zip$/)?.[1] ?? ''
    return bySlot(slot)
  })

describe('collect() records no slot whose payload carried no documents', () => {
  before(migrate)

  // Slots are processed newest first, and a failure aborts the run the way it did before the
  // Effect conversion, so the ok and entry-less slots are ordered ahead of the junk one to
  // exercise all three.
  const okSlot = '20260911120000'
  const emptyZipSlot = '20260911114500'
  const junkSlot = '20260911113000'
  const latest = okSlot

  const originalSlots = process.env.GKG_SLOTS
  after(() => {
    if (originalSlots === undefined) delete process.env.GKG_SLOTS
    else process.env.GKG_SLOTS = originalSlots
  })

  it('leaves a non-zip slot and an entry-less slot pending, and still records the ok slot', async () => {
    process.env.GKG_SLOTS = '4'
    const fetchFn = gkgFetch(latest, (slot) => {
      if (slot === junkSlot) return new Response(strToU8('<html>503 from the CDN</html>'), { status: 200 })
      if (slot === emptyZipSlot) return new Response(zipSync({}), { status: 200 })
      return new Response(zipSync({ 'entry.csv': strToU8(gkgRow(slot)) }), { status: 200 })
    })
    const exit = await runTest(collect, fetchFn)
    assert.ok(Exit.isFailure(exit))
    // unzipBounded's rejection surfaces as a defect (Effect.promise's contract), the same way
    // it aborted the run before the Effect conversion.
    assert.match(String(Cause.squash(exit.cause)), /invalid zip data/)
    for (const slot of [junkSlot, emptyZipSlot]) {
      const rows = (await db.query(`select 1 from gkg_files where slot = $1`, [slot])).rows
      assert.equal(rows.length, 0, `${slot} must stay pending so a later run retries it`)
    }
    const okRows = (await db.query(`select 1 from gkg_files where slot = $1`, [okSlot])).rows
    assert.equal(okRows.length, 1, 'a slot that really parsed must be recorded exactly once')
  })
})

// Issue #108: GDELT's V2Themes column is no longer read into extraTerms at all, even when the
// row carries one.
describe('collect() drops GDELT themes: extraTerms is always [] (issue #108)', () => {
  before(migrate)

  const latest = '20260911130000'

  it('returns every doc with extraTerms: [] even though the row carries themes', async () => {
    const fetchFn = gkgFetch(latest, (slot) => new Response(zipSync({ 'entry.csv': strToU8(gkgRow(slot, { themes: 'TAX_FNCACT_JUDGE;WB_678_ECONOMY' })) }), { status: 200 }))
    const exit = await runTest(collect, fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.ok(exit.value.length > 0, 'sanity: the stub must yield at least one doc')
    for (const d of exit.value) assert.deepEqual(d.extraTerms, [])
  })
})

// AC8/AC9: one pending slot resolves oversize (a declared content-length above
// MAX_RESPONSE_BYTES) among several that resolve ok. Proven against the actual gkg_files table.
describe('collect() skips an oversize slot without marking gkg_files, and the run finishes anyway', () => {
  before(migrate)

  const latest = '20260910120000'
  const oversizeSlot = '20260910114500'
  const okSlot = '20260910113000'

  it('resolves without failing and includes a doc from an ok slot even though one slot is oversize, with the same log wording as before', async () => {
    const fetchFn = gkgFetch(latest, (slot) => {
      if (slot === oversizeSlot) return new Response(null, { status: 200, headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } })
      return new Response(zipSync({ 'entry.csv': strToU8(gkgRow(slot)) }), { status: 200 })
    })
    const program = Effect.gen(function* () {
      const value = yield* collect
      const log = (yield* TestConsole.logLines).map(String)
      return { value, log }
    })
    const exit = await runTest(program, fetchFn)
    assert.ok(Exit.isSuccess(exit))
    const { value, log } = exit.value
    assert.ok(value.some((d) => d.uri === `https://example.org/${okSlot}`), 'the ok slot must still produce a doc')
    assert.ok(!value.some((d) => d.uri.includes(oversizeSlot)), 'the oversize slot must never produce a doc')
    const oversizeRows = (await db.query(`select 1 from gkg_files where slot = $1`, [oversizeSlot])).rows
    assert.equal(oversizeRows.length, 0, 'an oversize slot must never be inserted into gkg_files')
    const okRows = (await db.query(`select 1 from gkg_files where slot = $1`, [okSlot])).rows
    assert.equal(okRows.length, 1, 'a successfully parsed slot must be recorded in gkg_files exactly once')
    assert.equal(log[0], '[gkg] 24 of last 24 slots pending')
    assert.ok(log.some((l) => l === `[gkg] ${oversizeSlot}: oversize (compressed, ${MAX_RESPONSE_BYTES + 1} bytes > ${MAX_RESPONSE_BYTES} limit), skipped`))
    assert.ok(log.some((l) => l === `[gkg] ${okSlot}: 1 portuguese docs`))
  })
})

// Regression: a later slot timing out used to fail the whole Effect.forEach, discarding the
// docs an earlier slot had already produced even though that earlier slot's gkg_files row was
// already committed -- permanent silent loss. Each slot's failure must cost only that slot.
describe('collect() keeps an earlier slot\'s docs when a later slot times out', () => {
  before(migrate)

  const latest = '20260912120000'
  const timeoutSlot = '20260912114500' // processed second (older), stalls past GKG_DOWNLOAD_TIMEOUT_MS

  const originalSlots = process.env.GKG_SLOTS
  after(() => {
    if (originalSlots === undefined) delete process.env.GKG_SLOTS
    else process.env.GKG_SLOTS = originalSlots
  })

  it('still returns and records the ok slot, and logs the timeout instead of failing the run', async () => {
    process.env.GKG_SLOTS = '2'
    const fetchFn = fakeFetch((c) => {
      if (c.url.pathname.endsWith('lastupdate-translation.txt')) return new Response(`${latest}.translation.gkg.csv.zip`, { status: 200 })
      const slot = c.url.pathname.match(/\/(\d{14})\.translation\.gkg\.csv\.zip$/)?.[1] ?? ''
      if (slot === timeoutSlot) return hanging(c)
      return new Response(zipSync({ 'entry.csv': strToU8(gkgRow(slot)) }), { status: 200 })
    })
    const exit = await runTest(drain(collect, GKG_DOWNLOAD_TIMEOUT_MS), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    const { exit: innerExit, log } = exit.value
    assert.ok(Exit.isSuccess(innerExit), 'one slot timing out must not fail the whole collect()')
    if (!Exit.isSuccess(innerExit)) return
    assert.ok(innerExit.value.some((d) => d.uri === `https://example.org/${latest}`), 'the ok slot must still produce a doc')
    assert.ok(!innerExit.value.some((d) => d.uri.includes(timeoutSlot)), 'the timed-out slot must never produce a doc')
    const okRows = (await db.query(`select 1 from gkg_files where slot = $1`, [latest])).rows
    assert.equal(okRows.length, 1, 'the successfully parsed slot must be recorded exactly once')
    const timeoutRows = (await db.query(`select 1 from gkg_files where slot = $1`, [timeoutSlot])).rows
    assert.equal(timeoutRows.length, 0, 'a timed-out slot must stay pending so a later run retries it')
    assert.ok(log.some((l) => l.startsWith(`[gkg] ${timeoutSlot}:`) && l.endsWith('skipped')), `expected a skip log line for ${timeoutSlot}, got: ${JSON.stringify(log)}`)
  })
})

describe('download() driven through the FetchHttpClient.Fetch seam, no fetchImpl parameter (issue #183)', () => {
  const slot = '20260915000000'

  it('takes only a slot argument and resolves every SlotDownload outcome: missing, declared-oversize, streaming-oversize and ok (issue #183 AC10)', async () => {
    assert.equal(download.length, 1, 'download must take exactly one argument, the slot, no fetchImpl parameter')

    const missingFetch = fakeFetch(() => new Response(null, { status: 404 }))
    const missingExit = await runTest(download(slot), missingFetch)
    assert.ok(Exit.isSuccess(missingExit))
    assert.deepEqual(missingExit.value, { status: 'missing' })

    const declared = MAX_RESPONSE_BYTES + 10
    const declaredStream = new ReadableStream<Uint8Array>({ pull: () => {} }, { highWaterMark: 0 })
    const declaredFetch = fakeFetch(() => new Response(declaredStream, { status: 200, headers: { 'content-length': String(declared) } }))
    const declaredExit = await runTest(download(slot), declaredFetch)
    assert.ok(Exit.isSuccess(declaredExit))
    assert.deepEqual(declaredExit.value, { status: 'oversize', stage: 'compressed', bytes: declared, limit: MAX_RESPONSE_BYTES })

    const bigChunk = new Uint8Array(MAX_RESPONSE_BYTES)
    const streamingFetch = fakeFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bigChunk)
              controller.enqueue(new Uint8Array([9]))
              controller.close()
            },
          }),
          { status: 200 },
        ),
    )
    const streamingExit = await runTest(download(slot), streamingFetch)
    assert.ok(Exit.isSuccess(streamingExit))
    assert.deepEqual(streamingExit.value, { status: 'oversize', stage: 'compressed', bytes: MAX_RESPONSE_BYTES + 1, limit: MAX_RESPONSE_BYTES })

    const csv = 'domain\turl\ttitle\n'
    const zip = zipSync({ 'entry.csv': strToU8(csv) })
    const okFetch = fakeFetch(() => new Response(zip, { status: 200 }))
    const okExit = await runTest(download(slot), okFetch)
    assert.ok(Exit.isSuccess(okExit))
    assert.deepEqual(okExit.value, { status: 'ok', csv })
  })

  it('GKG_DOWNLOAD_TIMEOUT_MS is 300 000ms, distinct from REQUEST_TIMEOUT_MS: latestSlot is cut at REQUEST_TIMEOUT_MS, download at GKG_DOWNLOAD_TIMEOUT_MS (issue #183 AC11)', async () => {
    assert.equal(GKG_DOWNLOAD_TIMEOUT_MS, 300_000)
    assert.notEqual(GKG_DOWNLOAD_TIMEOUT_MS, REQUEST_TIMEOUT_MS)

    const latestFetch = fakeFetch(hanging)
    const latestExit = await runTest(drain(latestSlot, REQUEST_TIMEOUT_MS), latestFetch)
    assert.ok(Exit.isSuccess(latestExit))
    assert.equal(latestExit.value.elapsedMs, REQUEST_TIMEOUT_MS)
    assert.equal(latestFetch.calls[0].signal.aborted, true)

    const downloadFetch = fakeFetch(hanging)
    const downloadExit = await runTest(drain(download(slot), GKG_DOWNLOAD_TIMEOUT_MS), downloadFetch)
    assert.ok(Exit.isSuccess(downloadExit))
    assert.equal(downloadExit.value.elapsedMs, GKG_DOWNLOAD_TIMEOUT_MS)
    assert.equal(downloadFetch.calls[0].signal.aborted, true)
  })

  it('latestSlot fails with a message matching "gkg: cannot read lastupdate-translation.txt" when no slot pattern is present in the body (issue #183 AC12)', async () => {
    const fetchFn = fakeFetch(() => new Response('unexpected maintenance page', { status: 200 }))
    const error = failureOf(await runTest(latestSlot, fetchFn))
    assert.match(String(error), /gkg: cannot read lastupdate-translation\.txt/)
  })
})

describe('gkg log lines are unchanged text, read through TestConsole (issue #183)', () => {
  before(migrate)

  // GKG_SLOTS is read once into a module-level constant at import time, so a test cannot
  // change the window size at runtime; it asserts against the module's actual (default, 24)
  // window instead of trying to override it.
  it('logs "[gkg] <slot>: missing (404)" for a 404 slot, alongside the pending-count line (issue #183 AC13)', async () => {
    const latest = '20260912000000'
    const fetchFn = gkgFetch(latest, () => new Response(null, { status: 404 }))
    const program = Effect.gen(function* () {
      const value = yield* collect
      const log = (yield* TestConsole.logLines).map(String)
      return { value, log }
    })
    const exit = await runTest(program, fetchFn)
    assert.ok(Exit.isSuccess(exit))
    const { value, log } = exit.value
    assert.deepEqual(value, [])
    assert.equal(log[0], '[gkg] 24 of last 24 slots pending')
    assert.ok(log.includes(`[gkg] ${latest}: missing (404)`))
  })
})
