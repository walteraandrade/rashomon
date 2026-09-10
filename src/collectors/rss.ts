import { XMLParser } from 'fast-xml-parser'
import type { Collector, RawDoc, Source } from '../types.js'
import { headers } from '../http.js'
import { decodeEntities, domainOf } from '../extract.js'

// Both are the politics section, not the outlet's front page: only docs naming a tracked
// person get doc_terms rows, so a general feed spends most of its items on nobody. Measured
// 2026-09-09 (docs/sources-research.md): g1's front page returned 100 items, 18 of them
// naming someone tracked, at 2607 chars each; the politics feed returned 100 items, 89 of
// them naming someone, at 4392 chars -- it carries the article body, not just the headline.
// Folha's 'em cima da hora' went from 26 to 77 items naming someone at the same length.
const feeds = ['https://g1.globo.com/rss/g1/politica/', 'https://feeds.folha.uol.com.br/poder/rss091.xml']
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

const decode = (buf: ArrayBuffer) => {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  return /encoding=["']ISO-8859-1["']/i.test(utf8.slice(0, 200)) ? new TextDecoder('latin1').decode(buf) : utf8
}

const stripHtml = (s: unknown) => decodeEntities(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const asArray = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x])

const text = (v: unknown) => (typeof v === 'object' && v !== null ? String((v as any)['#text'] ?? '') : String(v ?? ''))
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const toDoc = (source: Source) => (item: any): RawDoc | null => {
  const uri = text(item.link).trim()
  if (!uri) return null
  const outletUrl = item.source?.['@_url'] as string | undefined
  const outletName = text(item.source).trim()
  const dropOutlet = (s: string) => (outletName ? s.replace(new RegExp(`(\\s+-)?\\s*${escapeRe(outletName)}`, 'g'), ' ') : s)
  return {
    source,
    uri,
    text: `${dropOutlet(stripHtml(item.title))}. ${dropOutlet(stripHtml(item.description))}`.replace(/\s+/g, ' '),
    publishedAt: new Date(text(item.pubDate) || Date.now()).toISOString(),
    domain: domainOf(outletUrl) ?? domainOf(uri),
  }
}

export const fetchFeed = (source: Source) => async (url: string): Promise<RawDoc[]> => {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${source} ${url} ${res.status}`)
  const xml = parser.parse(decode(await res.arrayBuffer()))
  return asArray<any>(xml?.rss?.channel?.item).map(toDoc(source)).filter((d): d is RawDoc => d !== null)
}

export const rss: Collector = async () => (await Promise.all(feeds.map(fetchFeed('rss')))).flat()
