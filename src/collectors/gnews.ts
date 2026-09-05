import type { Collector, Person } from '../types.js'
import { sequential } from '../http.js'
import { fetchFeed } from './rss.js'

const feedUrl = (person: Person) => {
  const url = new URL('https://news.google.com/rss/search')
  url.searchParams.set('q', person.name)
  url.searchParams.set('hl', 'pt-BR')
  url.searchParams.set('gl', 'BR')
  url.searchParams.set('ceid', 'BR:pt-419')
  return url.toString()
}

export const gnews: Collector = async (persons) =>
  (await sequential(persons, (p) => fetchFeed('gnews')(feedUrl(p)))).flat()
