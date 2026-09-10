import { Unzip, UnzipInflate } from 'fflate'
import type { Collector, RawDoc, Term } from '../types.js'
import { headers, sequential, headerLength, overLimit, readCapped, MAX_RESPONSE_BYTES } from '../http.js'
import { db } from '../db.js'
import { decodeEntities } from '../extract.js'

const base = 'https://data.gdeltproject.org/gdeltv2'
const slotMs = 15 * 60 * 1000
const slots = Number(process.env.GKG_SLOTS ?? 24)

// Bounds the *decompressed* stream, since only gkg unzips anything; MAX_RESPONSE_BYTES already
// bounds the compressed download before it gets here (see download() below).
export const MAX_EXPANDED_BYTES = 256 * 1024 * 1024

export type SlotDownload =
  | { status: 'missing' }
  | { status: 'oversize'; stage: 'compressed' | 'expanded'; bytes: number; limit: number }
  | { status: 'ok'; csv: string }

const concatBytes = (chunks: Uint8Array[], total: number): Uint8Array => {
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

// fflate's UnzipInflate defines no terminate(), so it cannot cut decompression short once
// started; a single unzip.push(wholeBuffer, true) call decompresses the whole entry
// synchronously before ondata ever gets a chance to see the running total. Feeding the
// compressed bytes in small slices instead, checking the stop flag between calls, bounds
// how much a single push() can inflate before the loop below gets a chance to stop feeding it.
// The bound is not exact: deflate tops out near 1032:1, so one 64KB slice can yield ~64MB and the
// effective ceiling is MAX_EXPANDED_BYTES + ~64MB, not MAX_EXPANDED_BYTES.
const PUSH_SLICE_BYTES = 64 * 1024

// A zip always ends with the end-of-central-directory record, signature PK\x05\x06, followed by
// at most a 65535-byte comment. Its presence is what separates an entry-less archive from bytes
// that are not a zip at all.
const EOCD = [0x50, 0x4b, 0x05, 0x06]
const EOCD_MAX_TRAILER = 22 + 0xffff

const hasCentralDirectoryEnd = (bytes: Uint8Array): boolean => {
  const from = Math.max(0, bytes.length - EOCD_MAX_TRAILER)
  for (let i = bytes.length - EOCD.length; i >= from; i--) {
    if (EOCD.every((byte, k) => bytes[i + k] === byte)) return true
  }
  return false
}

/**
 * Unzips the first entry of a GKG zip, bounded at limitBytes of *decompressed* output. Network-free
 * and independently testable with a zip built via fflate's own zipSync. Replaces a single unzipSync
 * call: fflate's Unzip streams entry.ondata as decompression proceeds, so a decompression-bomb shape
 * is caught mid-stream, at the injected limit, rather than after the whole file is in memory.
 */
export const unzipBounded = (zipBytes: Uint8Array, limitBytes = MAX_EXPANDED_BYTES): Promise<SlotDownload> =>
  new Promise((resolve, reject) => {
    const unzip = new Unzip()
    unzip.register(UnzipInflate)
    let sawEntry = false
    let stopped = false
    unzip.onfile = (file) => {
      if (sawEntry) return // first entry only, same semantics as the Object.values(files)[0] it replaces
      sawEntry = true
      const chunks: Uint8Array[] = []
      let total = 0
      file.ondata = (err, chunk, final) => {
        if (stopped) return // already resolved oversize; ignore whatever this push call still yields
        if (err) return reject(err)
        total += chunk.length
        if (overLimit(total, limitBytes)) {
          stopped = true
          file.terminate()
          resolve({ status: 'oversize', stage: 'expanded', bytes: total, limit: limitBytes })
          return
        }
        chunks.push(chunk)
        if (final) resolve({ status: 'ok', csv: new TextDecoder('utf-8').decode(concatBytes(chunks, total)) })
      }
      file.start()
    }
    let offset = 0
    do {
      const end = Math.min(offset + PUSH_SLICE_BYTES, zipBytes.length)
      unzip.push(zipBytes.subarray(offset, end), end === zipBytes.length)
      offset = end
    } while (offset < zipBytes.length && !stopped)
    if (!sawEntry && !stopped) {
      // No entry can mean an entry-less archive or, far more often, a payload that is not a zip
      // at all -- an HTML error page the CDN answered 200 with, or an empty body. fflate's Unzip
      // reports neither, so tell them apart here: only a real archive carries the end-of-central
      // -directory record. Anything else throws, as unzipSync did, so processSlot never records
      // the slot as done and a later run retries it.
      if (hasCentralDirectoryEnd(zipBytes)) resolve({ status: 'ok', csv: '' })
      else reject(new Error('invalid zip data'))
    }
  })

const col = { domain: 3, url: 4, themes: 7, persons: 11, tone: 15, translation: 25, extras: 26 } as const

const log = (msg: string) => console.log(`[gkg] ${msg}`)

const pad = (n: number) => String(n).padStart(2, '0')
const slotName = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`
const slotDate = (s: string) =>
  new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)))

const latestSlot = async () => {
  const txt = await (await fetch(`${base}/lastupdate-translation.txt`, { headers })).text()
  const m = txt.match(/(\d{14})\.translation\.gkg\.csv\.zip/)
  if (!m) throw new Error('gkg: cannot read lastupdate-translation.txt')
  return m[1]
}

const recentSlots = (latest: string) =>
  Array.from({ length: slots }, (_, i) => slotName(new Date(slotDate(latest).getTime() - i * slotMs)))

const processedSlots = async () =>
  new Set((await db.query<{ slot: string }>(`select slot from gkg_files`)).rows.map((r) => r.slot))

export const download = async (slot: string, fetchImpl: typeof fetch = fetch): Promise<SlotDownload> => {
  const res = await fetchImpl(`${base}/${slot}.translation.gkg.csv.zip`, { headers })
  if (res.status === 404) return { status: 'missing' }
  if (!res.ok) throw new Error(`gkg ${slot}: ${res.status}`)

  const declared = headerLength(res.headers.get('content-length'))
  if (declared !== null && overLimit(declared, MAX_RESPONSE_BYTES)) {
    return { status: 'oversize', stage: 'compressed', bytes: declared, limit: MAX_RESPONSE_BYTES }
  }

  const capped = await readCapped(res.body, MAX_RESPONSE_BYTES)
  if (!capped.ok) return { status: 'oversize', stage: 'compressed', bytes: capped.bytes, limit: MAX_RESPONSE_BYTES }

  return unzipBounded(capped.data, MAX_EXPANDED_BYTES)
}

const themeTerm = (t: string): Term => ({ kind: 'theme', term: t.toLowerCase().replace(/^(tax_fncact_|tax_|wb_\d+_)/, '') })

const rowToDoc = (slot: string) => (cols: string[]): RawDoc | null => {
  const title = decodeEntities(cols[col.extras]?.match(/<PAGE_TITLE>(.*?)<\/PAGE_TITLE>/)?.[1] ?? '')
  if (!title || !cols[col.url]) return null
  const themes = [...new Set((cols[col.themes] ?? '').split(';').filter((t) => t && !/^tax_fncact$/i.test(t)))]
  return {
    source: 'gkg',
    uri: cols[col.url],
    text: title,
    publishedAt: slotDate(slot).toISOString(),
    domain: cols[col.domain]?.toLowerCase().replace(/^www\./, '') || undefined,
    tone: Number.isFinite(parseFloat(cols[col.tone] ?? '')) ? parseFloat(cols[col.tone]) : undefined,
    extraTerms: themes.map(themeTerm),
    extraNames: [...new Set((cols[col.persons] ?? '').split(';').map((n) => n.trim()).filter(Boolean))],
  }
}

const parse = (slot: string, csv: string): RawDoc[] =>
  csv
    .split('\n')
    .filter((line) => line.includes('srclc:por'))
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length >= 27 && cols[col.translation].includes('srclc:por'))
    .map(rowToDoc(slot))
    .filter((d): d is RawDoc => d !== null)

const processSlot = async (slot: string): Promise<RawDoc[]> => {
  const result = await download(slot)
  if (result.status === 'missing') return (log(`${slot}: missing (404)`), [])
  if (result.status === 'oversize') {
    // Not marked done in gkg_files, so the next gkg() run sees this slot as pending again --
    // a transient outlier eventually succeeds or ages out of the GKG_SLOTS look-back window.
    log(`${slot}: oversize (${result.stage}, ${result.bytes} bytes > ${result.limit} limit), skipped`)
    return []
  }
  if (result.csv === '') {
    // An entry-less archive, which master reported as `null` and therefore never marked done.
    // Keep that: recording it would retire the slot on the strength of an empty answer.
    log(`${slot}: empty archive, skipped`)
    return []
  }
  const docs = parse(slot, result.csv)
  await db.query(`insert into gkg_files (slot, rows) values ($1, $2) on conflict do nothing`, [slot, docs.length])
  log(`${slot}: ${docs.length} portuguese docs`)
  return docs
}

export const gkg: Collector = async () => {
  const done = await processedSlots()
  const pending = recentSlots(await latestSlot()).filter((s) => !done.has(s))
  log(`${pending.length} of last ${slots} slots pending`)
  return (await sequential(pending, processSlot)).flat()
}
