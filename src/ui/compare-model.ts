import { fmt } from './format.js'

export type CompareMode = 'pessoas' | 'recortes'

export const THIN_ABOUT = 50

const LEGACY_LENS_KEYS = ['lenses.person', 'lenses.a', 'lenses.b', 'lenses.days', 'lenses.limit']

// `compare.mode` wins; otherwise any legacy `lenses.*` key opens lens mode. A bare key never does.
export const compareModeFor = (search: string): CompareMode => {
  const params = new URLSearchParams(search)
  const own = params.get('compare.mode')
  if (own === 'pessoas' || own === 'recortes') return own
  return LEGACY_LENS_KEYS.some((key) => params.has(key)) ? 'recortes' : 'pessoas'
}

export const thinNoteText = (sides: { label: string; about: number }[]): string => {
  const sentences = sides
    .filter((s) => s.about < THIN_ABOUT)
    .map((s) => `${s.label} tem só ${fmt(s.about)} ${s.about === 1 ? 'texto' : 'textos'} neste recorte: leia com cuidado.`)
  return sentences.filter((text, i) => sentences.indexOf(text) === i).join(' ')
}
