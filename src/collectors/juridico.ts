import type { Collector } from '../types.js'
import { fetchFeed } from './rss.js'

const feeds = ['https://noticias.stf.jus.br/feed/', 'https://www.conjur.com.br/rss.xml', 'https://www.jota.info/feed']

export const juridico: Collector = async () => (await Promise.all(feeds.map(fetchFeed('juridico')))).flat()
