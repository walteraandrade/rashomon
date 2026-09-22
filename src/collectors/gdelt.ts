import { Console, Effect } from 'effect'
import type { HttpClient } from 'effect/unstable/http'
import type { Collector, Person, RawDoc } from '../types.js'
import { getBytes, parseJson, runWithFetch } from '../http.js'

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

// 429 retried up to 3 times, waiting rateLimitMs * 4 * attempt (22s, 44s, 66s) between them;
// a non-JSON body (any other status, or the 4th 429) fails with the status and the head of it.
const attempt = (person: Person, n: number): Effect.Effect<any[], Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    yield* Console.log(`[gdelt] ${person.id}: request ${n}/4 (connect takes ~15s)`)
    const { status, body } = yield* getBytes(queryUrl(person))
    const text = new TextDecoder().decode(body)
    if (status === 429 && n <= 3) {
      const wait = rateLimitMs * 4 * n
      yield* Console.log(`[gdelt] ${person.id}: 429 rate limited, waiting ${Math.round(wait / 1000)}s`)
      yield* Effect.sleep(wait)
      return yield* attempt(person, n + 1)
    }
    if (!text.trim().startsWith('{')) return yield* Effect.fail(new Error(`gdelt ${status}: ${text.trim().slice(0, 80)}`))
    const articles = (yield* parseJson<{ articles?: any[] }>(text)).articles ?? []
    yield* Console.log(`[gdelt] ${person.id}: ${articles.length} articles`)
    return articles
  })

// A person's failure costs that person's articles and a log line; the per-person pause after a
// successful or failed request is unchanged either way.
const collectPerson = (person: Person): Effect.Effect<RawDoc[], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const articles = yield* attempt(person, 1).pipe(
      Effect.catch((e) => Console.error(`[gdelt] ${person.id}: ${e.message}`).pipe(Effect.as([] as any[]))),
    )
    yield* Effect.sleep(rateLimitMs)
    return articles.map((a) => ({
      source: 'gdelt' as const,
      uri: a.url,
      text: cleanTitle(a.title ?? ''),
      publishedAt: toIso(a.seendate),
      domain: String(a.domain ?? '').toLowerCase() || undefined,
    }))
  })

export const collect = (persons: Person[]): Effect.Effect<RawDoc[], never, HttpClient.HttpClient> =>
  Effect.forEach(persons, collectPerson).pipe(Effect.map((docs) => docs.flat()))

export const gdelt: Collector = (persons) => runWithFetch(collect(persons))
