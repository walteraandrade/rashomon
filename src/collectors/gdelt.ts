import type { Collector, Person, RawDoc } from '../types.js'
import { sequential, sleep, slowGet } from '../http.js'

const base = 'https://api.gdeltproject.org/api/v2/doc/doc'
const rateLimitMs = 5500

const toIso = (s: string) => s.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')
const phrase = (name: string) => (name.includes(' ') ? `"${name}"` : name)
const cleanTitle = (t: string) => t.replace(/\s-\s\d{2}\s\/\s\d{2}\s\/\s\d{4}.*$/, '')

const queryUrl = (person: Person) => {
  const url = new URL(base)
  url.searchParams.set('query', `${phrase(person.name)} sourcelang:portuguese`)
  url.searchParams.set('mode', 'artlist')
  url.searchParams.set('format', 'json')
  url.searchParams.set('timespan', '30d')
  url.searchParams.set('maxrecords', '250')
  return url
}

const log = (msg: string) => console.log(`[gdelt] ${msg}`)

const fetchArticles = async (person: Person, attempt = 1): Promise<any[]> => {
  log(`${person.id}: request ${attempt}/4 (connect takes ~15s)`)
  const { status, body } = await slowGet(queryUrl(person))
  if (status === 429 && attempt <= 3) {
    const wait = rateLimitMs * 4 * attempt
    log(`${person.id}: 429 rate limited, waiting ${Math.round(wait / 1000)}s`)
    return sleep(wait).then(() => fetchArticles(person, attempt + 1))
  }
  if (!body.trim().startsWith('{')) throw new Error(`gdelt ${status}: ${body.trim().slice(0, 80)}`)
  const articles = (JSON.parse(body) as { articles?: any[] }).articles ?? []
  log(`${person.id}: ${articles.length} articles`)
  return articles
}

const collectPerson = async (person: Person): Promise<RawDoc[]> => {
  const articles = await fetchArticles(person).catch((e: Error) => (console.error(`[gdelt] ${person.id}: ${e.message}`), []))
  await sleep(rateLimitMs)
  return articles.map((a) => ({
    source: 'gdelt' as const,
    uri: a.url,
    text: cleanTitle(a.title ?? ''),
    publishedAt: toIso(a.seendate),
    domain: String(a.domain ?? '').toLowerCase() || undefined,
  }))
}

export const gdelt: Collector = async (persons) => (await sequential(persons, collectPerson)).flat()
