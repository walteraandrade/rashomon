import type { Collector } from '../types.js'
import { fetchFeed } from './rss.js'

const feeds = [
  'https://www.brasildefato.com.br/feed',
  'https://revistaforum.com.br/feed',
  'https://www.cartacapital.com.br/feed/',
  'https://www.gazetadopovo.com.br/feed/rss/republica.xml',
  'https://oantagonista.com.br/feed/',
  'https://www.intercept.com.br/feed/',
  'https://apublica.org/feed/',
  'https://www.aosfatos.org/noticias/feed/',
  'https://lupa.uol.com.br/feed',
]

export const nicho: Collector = async () => (await Promise.all(feeds.map(fetchFeed('nicho')))).flat()
