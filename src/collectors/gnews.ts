import { Effect } from 'effect'
import type { Collector, Person } from '../types.js'
import { runWithFetch } from '../http.js'
import { fetchFeed } from './rss.js'

const feedUrl = (person: Person) => {
  const url = new URL('https://news.google.com/rss/search')
  url.searchParams.set('q', person.name)
  url.searchParams.set('hl', 'pt-BR')
  url.searchParams.set('gl', 'BR')
  url.searchParams.set('ceid', 'BR:pt-419')
  return url.toString()
}

// One person's feed at a time -- Effect.forEach's default concurrency, the same pacing
// `sequential` gave this collector before the Effect conversion.
export const collect = (persons: Person[]) =>
  Effect.forEach(persons, (p) => fetchFeed('gnews')(feedUrl(p))).pipe(Effect.map((docs) => docs.flat()))

export const gnews: Collector = (persons) => runWithFetch(collect(persons))
