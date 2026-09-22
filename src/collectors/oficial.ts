import { Effect } from 'effect'
import type { Collector } from '../types.js'
import { runWithFetch } from '../http.js'
import { fetchFeed } from './rss.js'

const feeds = [
  'https://www.camara.leg.br/noticias/rss/dinamico/POLITICA',
  'https://www.camara.leg.br/noticias/rss/dinamico/ELEICOES',
  'https://www12.senado.leg.br/noticias/rss',
  'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml',
]

export const collect = Effect.forEach(feeds, fetchFeed('oficial'), { concurrency: 'unbounded' }).pipe(Effect.map((docs) => docs.flat()))

export const oficial: Collector = () => runWithFetch(collect)
