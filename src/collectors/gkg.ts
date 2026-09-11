import { Unzip, UnzipInflate } from 'fflate'
import type { Collector, RawDoc } from '../types.js'
import { headers, sequential, headerLength, overLimit, readCapped, MAX_RESPONSE_BYTES } from '../http.js'
import { db } from '../db.js'
import { decodeEntities } from '../extract.js'

const base = 'https://data.gdeltproject.org/gdeltv2'
const slotMs = 15 * 60 * 1000
const slots = Number(process.env.GKG_SLOTS ?? 24)

// MAX_EXPANDED_BYTES bounds the *decompressed* stream; MAX_RESPONSE_BYTES bounds the download.
export const MAX_EXPANDED_BYTES = 128 * 1024 * 1024

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

// Feeds the compressed bytes in small slices so the oversize check fires mid-stream.
// One 16KB slice can yield ~16MB (deflate peaks near 1032:1), so effective ceiling is MAX_EXPANDED_BYTES + ~16MB.
const PUSH_SLICE_BYTES = 16 * 1024

// EOCD record (PK\x05\x06) distinguishes an entry-less archive from a non-zip payload.
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
      // No entry: EOCD present means entry-less archive (ok, empty csv); absent means not a zip.
      // An invalid zip is rejected so processSlot never records the slot as done and retries it.
      if (hasCentralDirectoryEnd(zipBytes)) resolve({ status: 'ok', csv: '' })
      else reject(new Error('invalid zip data'))
    }
  })

const col = { domain: 3, url: 4, persons: 11, tone: 15, translation: 25, extras: 26 } as const

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

const rowToDoc = (slot: string) => (cols: string[]): RawDoc | null => {
  const title = decodeEntities(cols[col.extras]?.match(/<PAGE_TITLE>(.*?)<\/PAGE_TITLE>/)?.[1] ?? '')
  if (!title || !cols[col.url]) return null
  return {
    source: 'gkg',
    uri: cols[col.url],
    text: title,
    publishedAt: slotDate(slot).toISOString(),
    domain: cols[col.domain]?.toLowerCase().replace(/^www\./, '') || undefined,
    tone: Number.isFinite(parseFloat(cols[col.tone] ?? '')) ? parseFloat(cols[col.tone]) : undefined,
    extraTerms: [],
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
    // oversize: not marked done, so the next run retries it or it ages out of the look-back window.
    log(`${slot}: oversize (${result.stage}, ${result.bytes} bytes > ${result.limit} limit), skipped`)
    return []
  }
  if (result.csv === '') {
    // Empty archive: not recorded as done; retrying may get a real answer.
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
