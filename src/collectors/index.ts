import type { Collector, Source } from '../types.js'
import { bluesky } from './bluesky.js'
import { gdelt } from './gdelt.js'
import { rss } from './rss.js'
import { gnews } from './gnews.js'
import { gkg } from './gkg.js'

export const collectors: Record<Source, Collector> = { bluesky, gdelt, rss, gnews, gkg }
export const defaultSources: Source[] = ['bluesky', 'rss', 'gnews', 'gkg']
