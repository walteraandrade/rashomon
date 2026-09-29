import type { Collector, Source } from '../types.js'
import { collect as bluesky } from './bluesky.js'
import { collect as gdelt } from './gdelt.js'
import { collect as rss } from './rss.js'
import { collect as gnews } from './gnews.js'
import { collect as gkg } from './gkg.js'
import { collect as camara } from './camara.js'
import { collect as senado } from './senado.js'
import { collect as juridico } from './juridico.js'
import { collect as oficial } from './oficial.js'
import { collect as nicho } from './nicho.js'

// rss, gkg, juridico, oficial and nicho collect the same effect for every call (no per-person
// URL), so their `collect` export is a value, not a function of `persons`; wrapped here so the
// registry has one shape.
export const collectors: Record<Source, Collector> = {
  bluesky,
  gdelt,
  rss: () => rss,
  gnews,
  gkg: () => gkg,
  camara,
  senado,
  juridico: () => juridico,
  oficial: () => oficial,
  nicho: () => nicho,
}
// gkg first: a publisher URL it shares with rss/juridico/oficial/nicho is claimed by whoever
// stores it first, and only a gkg row keeps its orgs, V1Persons names and tone (a later feed
// body still enriches its text). Bluesky last: its authenticated search answers in ~7 s a page
// and takes ~20 min for every person, so a slow day must not keep the fast sources from being
// written first.
export const defaultSources: Source[] = ['gkg', 'rss', 'gnews', 'senado', 'camara', 'juridico', 'oficial', 'nicho', 'bluesky']
