import type { Collector, Source } from '../types.js'
import { bluesky } from './bluesky.js'
import { gdelt } from './gdelt.js'
import { rss } from './rss.js'
import { gnews } from './gnews.js'
import { gkg } from './gkg.js'
import { camara } from './camara.js'
import { senado } from './senado.js'
import { juridico } from './juridico.js'
import { oficial } from './oficial.js'
import { nicho } from './nicho.js'

export const collectors: Record<Source, Collector> = { bluesky, gdelt, rss, gnews, gkg, camara, senado, juridico, oficial, nicho }
// Bluesky last: its authenticated search answers in ~7 s a page and takes ~20 min for
// every person, so a slow day must not keep the fast sources from being written first.
export const defaultSources: Source[] = ['rss', 'gnews', 'gkg', 'senado', 'camara', 'juridico', 'oficial', 'nicho', 'bluesky']
