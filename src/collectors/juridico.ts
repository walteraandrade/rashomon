import { Effect } from 'effect'
import type { HttpClient } from 'effect/unstable/http'
import type { Collector, RawDoc } from '../types.js'
import { runWithFetch } from '../http.js'
import { fetchFeed } from './rss.js'

const feeds = ['https://noticias.stf.jus.br/feed/', 'https://www.conjur.com.br/rss.xml', 'https://www.jota.info/feed']

export const collect: Effect.Effect<RawDoc[], unknown, HttpClient.HttpClient> = Effect.forEach(feeds, fetchFeed('juridico'), {
  concurrency: 'unbounded',
}).pipe(Effect.map((docs) => docs.flat()))

export const juridico: Collector = () => runWithFetch(collect)
