import type { Collector } from '../types.js'
import { fetchFeed } from './rss.js'

const feeds = [
  'https://www.camara.leg.br/noticias/rss/dinamico/POLITICA',
  'https://www.camara.leg.br/noticias/rss/dinamico/ELEICOES',
  'https://www12.senado.leg.br/noticias/rss',
  'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml',
]

export const oficial: Collector = async () => (await Promise.all(feeds.map(fetchFeed('oficial')))).flat()
