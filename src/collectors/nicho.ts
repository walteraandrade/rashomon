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
  // The only feed found on 2026-09-10 that still puts the article body in `description`
  // (1949 chars a item against the family's 100-400), and the right-of-centre half of the
  // corpus is the thin one. See docs/sources-research.md.
  'https://revistaoeste.com/feed/',
]

export const nicho: Collector = async () => (await Promise.all(feeds.map(fetchFeed('nicho')))).flat()
