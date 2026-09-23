import { XMLParser } from 'fast-xml-parser'
import { Data, Effect } from 'effect'
import type { RawDoc, Source } from '../types.js'
import { ResponseTooLarge, getBytes } from '../http.js'
import { decodeEntities, domainOf } from '../extract.js'

// Politics sections where available; `content:encoded` feeds added for outlets that publish no politics section.
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

export class RssError extends Data.TaggedError('RssError')<{ message: string }> {}

const decode = (buf: Uint8Array) => {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  return /encoding=["']ISO-8859-1["']/i.test(utf8.slice(0, 200)) ? new TextDecoder('latin1').decode(buf) : utf8
}

const stripHtml = (s: unknown) => decodeEntities(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const asArray = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x])

const text = (v: unknown) => (typeof v === 'object' && v !== null ? String((v as any)['#text'] ?? '') : String(v ?? ''))
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// `content:encoded` is the full article body; description wins only when it is longer.
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

// One capped, timed GET (getBytes' REQUEST_TIMEOUT_MS default) plus the XML parse. No retry: a
// stalled or oversize feed fails this feed alone, and Effect.forEach's default fail-fast
// interrupts the sibling requests a caller ran alongside it.
export const fetchFeed = (source: Source) => (url: string) =>
  getBytes(url).pipe(
    // ResponseTooLarge already names its own url; anything else (a timeout, a network error)
    // gets the feed stitched in here, so a failed run always says which of the family's feeds broke.
    Effect.mapError((e) => (e instanceof ResponseTooLarge ? e : new RssError({ message: `${source} ${url}: ${e instanceof Error ? e.message : String(e)}` }))),
    Effect.flatMap(({ status, body }) => {
      if (status < 200 || status >= 300) return Effect.fail(new RssError({ message: `${source} ${url} ${status}` }))
      const xml = parser.parse(decode(body))
      return Effect.succeed(asArray<any>(xml?.rss?.channel?.item).map(toDoc(source)).filter((d): d is RawDoc => d !== null))
    }),
  )

export const collect = Effect.forEach(feeds, fetchFeed('rss'), { concurrency: 'unbounded' }).pipe(Effect.map((docs) => docs.flat()))

