import { Effect } from 'effect'
import { fetchFeed } from './rss.js'

const feeds = ['https://noticias.stf.jus.br/feed/', 'https://www.conjur.com.br/rss.xml', 'https://www.jota.info/feed']

export const collect = Effect.forEach(feeds, fetchFeed('juridico'), { concurrency: 'unbounded' }).pipe(Effect.map((docs) => docs.flat()))
