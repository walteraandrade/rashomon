import { unzipSync } from 'fflate'
import type { Collector, RawDoc, Term } from '../types.js'
import { headers, sequential } from '../http.js'
import { db } from '../db.js'
import { decodeEntities } from '../extract.js'

const base = 'https://data.gdeltproject.org/gdeltv2'
const slotMs = 15 * 60 * 1000
const slots = Number(process.env.GKG_SLOTS ?? 24)

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

const download = async (slot: string): Promise<string | null> => {
  const res = await fetch(`${base}/${slot}.translation.gkg.csv.zip`, { headers })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`gkg ${slot}: ${res.status}`)
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
  const entry = Object.values(files)[0]
  return entry ? new TextDecoder('utf-8').decode(entry) : null
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
  const csv = await download(slot)
  if (csv === null) return (log(`${slot}: missing (404)`), [])
  const docs = parse(slot, csv)
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
