import { XMLParser } from 'fast-xml-parser'
import type { Collector, RawDoc, Source } from '../types.js'
import { headers, headerLength, overLimit, readCapped, MAX_RESPONSE_BYTES } from '../http.js'
import { decodeEntities, domainOf } from '../extract.js'

// The politics section, not the outlet's front page, wherever one exists: only docs naming a
// tracked person get doc_terms rows, so a general feed spends most of its items on nobody.
// Measured 2026-09-09 (docs/sources-research.md): g1's front page returned 100 items, 18 of them
// naming someone tracked, at 2607 chars each; the politics feed returned 100 items, 89 of them
// naming someone, at 4392 chars -- it carries the article body, not just the headline. Folha's
// 'em cima da hora' went from 26 to 77 items naming someone at the same length.
//
// The six below were added for `content:encoded`, the whole article a publisher syndicates on
// purpose (docs/sources-research.md, "Third pass"). Four of them are the outlet's whole site
// because that outlet publishes no politics feed at all -- each one checked and written down in
// that same page, "Fourth pass". g1 and Folha's own sections fill `description` instead, which
// `body()` already prefers when it is the longer of the two.
const feeds = [
  'https://g1.globo.com/rss/g1/politica/',
  'https://feeds.folha.uol.com.br/poder/rss091.xml',
  'https://www.cnnbrasil.com.br/feed/',
  'https://www.metropoles.com/feed',
  'https://www.poder360.com.br/feed/',
  'https://veja.abril.com.br/politica/feed/',
  'https://www.correiobraziliense.com.br/rss/noticia/politica/rss.xml',
  'https://www.osul.com.br/feed/',
]
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

const decode = (buf: Uint8Array) => {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  return /encoding=["']ISO-8859-1["']/i.test(utf8.slice(0, 200)) ? new TextDecoder('latin1').decode(buf) : utf8
}

const stripHtml = (s: unknown) => decodeEntities(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const asArray = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x])

const text = (v: unknown) => (typeof v === 'object' && v !== null ? String((v as any)['#text'] ?? '') : String(v ?? ''))
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// `content:encoded` is the element a publisher uses to syndicate the whole article, and it is
// the only place in this project a full body ever comes from: nothing here fetches an article
// page. Nine of the feeds already collected fill it (see docs/sources.md), at 15x to 62x the
// characters of `description`, and the experiment in docs/sources-research.md shows characters
// per document is what moves the graph. `description` still wins when it is the longer of the
// two, since some feeds put only a caption or an embed in `content:encoded`.
export const body = (item: any) => {
  const encoded = stripHtml(item['content:encoded'])
  const description = stripHtml(item.description)
  return encoded.length > description.length ? encoded : description
}

export const toDoc = (source: Source) => (item: any): RawDoc | null => {
  const uri = text(item.link).trim()
  if (!uri) return null
  const outletUrl = item.source?.['@_url'] as string | undefined
  const outletName = text(item.source).trim()
  const dropOutlet = (s: string) => (outletName ? s.replace(new RegExp(`(\\s+-)?\\s*${escapeRe(outletName)}`, 'g'), ' ') : s)
  return {
    source,
    uri,
    text: `${dropOutlet(stripHtml(item.title))}. ${dropOutlet(body(item))}`.replace(/\s+/g, ' '),
    publishedAt: new Date(text(item.pubDate) || Date.now()).toISOString(),
    domain: domainOf(outletUrl) ?? domainOf(uri),
  }
}

export const fetchFeed = (source: Source) => async (url: string): Promise<RawDoc[]> => {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${source} ${url} ${res.status}`)

  const declared = headerLength(res.headers.get('content-length'))
  if (declared !== null && overLimit(declared, MAX_RESPONSE_BYTES)) {
    throw new Error(`${source} ${url}: response too large (declared ${declared} bytes exceeds ${MAX_RESPONSE_BYTES})`)
  }
  const capped = await readCapped(res.body, MAX_RESPONSE_BYTES)
  if (!capped.ok) throw new Error(`${source} ${url}: response too large (exceeded ${MAX_RESPONSE_BYTES} bytes while streaming)`)

  const xml = parser.parse(decode(capped.data))
  return asArray<any>(xml?.rss?.channel?.item).map(toDoc(source)).filter((d): d is RawDoc => d !== null)
}

export const rss: Collector = async () => (await Promise.all(feeds.map(fetchFeed('rss')))).flat()
