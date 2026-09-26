import { Console, Effect } from 'effect'
import type { HttpClient } from 'effect/unstable/http'
import type { Person } from '../types.js'
import { getBytes, parseJson } from '../http.js'

// Not a Collector: no RawDoc. A curiosity signal kept out of count/pmi/tone, never testimony.
const base = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/pt.wikipedia/all-access/all-agents'
const windowDays = 14
const pauseMs = 1000

const isoStamp = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')

const pageviewsUrl = (title: string) => {
  const now = new Date()
  const start = new Date(now.getTime() - windowDays * 86_400_000)
  return `${base}/${encodeURIComponent(title.trim().replace(/ /g, '_'))}/daily/${isoStamp(start)}/${isoStamp(now)}`
}

export type AttentionRow = { person_id: string; day: string; views: number }

type PageviewItem = { timestamp: string; views: number }

// Wikimedia's own YYYYMMDDHH, read as a UTC calendar day as-is, never re-bucketed into BRT.
const dayOf = (timestamp: string): string => `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`

// 429/5xx retried up to 3 times, mirroring camara.ts's backoff shape (4s, 8s, 12s).
const attempt = (title: string, n: number): Effect.Effect<PageviewItem[], Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const { status, body } = yield* getBytes(pageviewsUrl(title))
    const text = new TextDecoder().decode(body)
    if ((status === 429 || status >= 500) && n <= 3) {
      const wait = pauseMs * 4 * n
      yield* Console.log(`[pageviews] ${title}: ${status}, retrying in ${Math.round(wait / 1000)}s (attempt ${n}/3)`)
      yield* Effect.sleep(wait)
      return yield* attempt(title, n + 1)
    }
    if (status < 200 || status >= 300) return yield* Effect.fail(new Error(`pageviews ${status}: ${text.trim().slice(0, 120)}`))
    return (yield* parseJson<{ items?: PageviewItem[] }>(text)).items ?? []
  })

// A person's failure costs that person's rows and a log line, never the run.
const collectPerson = (person: Person): Effect.Effect<AttentionRow[], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    if (!person.wikipedia) return []
    const items = yield* attempt(person.wikipedia, 1).pipe(
      Effect.catch((e) => Console.error(`[pageviews] ${person.id}: ${e.message}`).pipe(Effect.as([] as PageviewItem[]))),
    )
    yield* Console.log(`[pageviews] ${person.id}: ${items.length} days`)
    yield* Effect.sleep(pauseMs)
    return items
      .filter((item) => Number.isInteger(item.views) && item.views >= 0 && /^\d{8}/.test(item.timestamp))
      .map((item) => ({ person_id: person.id, day: dayOf(item.timestamp), views: item.views }))
  })

export const collect = (persons: Person[]): Effect.Effect<AttentionRow[], never, HttpClient.HttpClient> =>
  Effect.forEach(persons, collectPerson).pipe(Effect.map((rows) => rows.flat()))
