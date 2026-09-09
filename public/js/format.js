// Pure helpers: text formatting, labels and URL derivation. No DOM, no fetch, no mutable
// state, so every function here is directly importable and testable under node:test.
//
// This file also carries the client's shared type vocabulary as JSDoc typedefs; the other
// modules reference them as import('./format.js').Term and friends, so `tsc` checks
// public/js the same way it checks src/ (tsconfig.json sets checkJs).

/**
 * @typedef {{ score: number, n: number }} TermTestimony
 * @typedef {{ id: string, term: string, kind: string, count: number, pmi: number, testimony?: TermTestimony | null }} Term
 * @typedef {{ source: string, target: string, count: number }} Link
 * @typedef {{ method: string, score: number | null, n: number }} PersonTestimony
 * @typedef {{ person: { id: string, name: string }, stats?: { about?: number, testimony?: PersonTestimony }, nodes: Term[], links: Link[] }} Graph
 * @typedef {{ source?: string, uri?: unknown, domain?: string | null, text?: string }} Doc
 * @typedef {{ domain?: string | null, source?: string | null, label?: string | null, docs: number, tone?: number | null }} OutletRow
 * @typedef {{ id: string, source: string, text: string }} Sample
 * @typedef {{ name: string, count: number, sources: number, previous: number, samples: Sample[] }} Candidate
 * @typedef {{ score: number | null, n: number }} TestimonyOverall
 * @typedef {{ source: string, score: number | null, n: number }} TestimonySourceRow
 * @typedef {{ domain: string, source: string, score: number | null, n: number }} TestimonyDomainRow
 * @typedef {{ method: string, overall: TestimonyOverall, by_source: TestimonySourceRow[], by_domain: TestimonyDomainRow[] }} Testimony
 * @typedef {(text: string, size: number, family?: string, weight?: number) => number} Measure
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 * @typedef {Box & { lines: string[], size: number, lineHeight: number, id?: string }} CenterBox
 * @typedef {Term & Box & { rank: number, size: number, lines: string[], lineHeight: number, score: number }} PlacedTerm
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ points: Point[], ports: Map<string, number[]>, adjacent: { index: number, weight: number }[][] }} Routing
 * @typedef {{ placed: PlacedTerm[], overflow: Term[], center: CenterBox, routing?: Routing }} Layout
 */

/** @type {Record<string, string>} */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** @param {unknown} value */
export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])

/** @param {unknown} value */
export const fmt = (value) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })

/** @param {{ kind?: string, term: string }} n */
export const label = (n) => (n.kind === 'hashtag' ? '#' : '') + n.term

/** @param {unknown} s */
export const normalize = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()

/** @type {Record<string, string>} */
export const kinds = { word: 'Palavra', hashtag: 'Hashtag', theme: 'Tema', phrase: 'Expressão' }

/** @type {Record<string, string>} */
export const sourceLabels = {
  all: 'todas as fontes',
  bluesky: 'Bluesky',
  gdelt: 'GDELT',
  rss: 'RSS',
  gnews: 'Google News',
  gkg: 'GKG',
  camara: 'Câmara',
  senado: 'Senado',
  juridico: 'Jurídico',
  oficial: 'Oficial',
  nicho: 'Nicho',
}

// The options of the source <select> in the sentence, [value, compact pt-BR label]. One shared list
// feeding one shared change handler (boot() in app.js): a new source only needs an entry
// here plus its pt-BR label in sourceLabels, never a bespoke handler.
export const SOURCE_SEGMENTS = [
  ['all', 'todas'],
  ['bluesky', 'bluesky'],
  ['gdelt', 'gdelt'],
  ['rss', 'rss'],
  ['gnews', 'g.news'],
  ['gkg', 'gkg'],
  ['camara', 'câmara'],
  ['senado', 'senado'],
  ['juridico', 'jurídico'],
  ['oficial', 'oficial'],
  ['nicho', 'nicho'],
]

// sort='pmi' orders by pmi * ln(1 + count), matching src/graph.ts's sort=pmi contract on
// purpose, so the client's node sizing never drifts from the server's own ordering.
/** @param {{ pmi?: number, count?: number }} n @param {string} sort */
export const score = (n, sort) => (sort === 'pmi' ? Number(n.pmi || 0) * Math.log1p(Number(n.count || 0)) : Number(n.count || 0))

/** @param {string} sort */
export const scoreName = (sort) => (sort === 'pmi' ? 'PMI × ln(1 + docs)' : 'frequência em documentos')

/** @param {{ kind?: string, term: string }} n @param {unknown} query */
export const matching = (n, query) => normalize(label(n)).includes(normalize(query))

/**
 * @param {Term[]} nodes
 * @param {Link[]} links
 * @param {string | null} id
 * @returns {{ node: Term, count: number }[]}
 */
export const relatedTo = (nodes, links, id) =>
  links
    .filter((l) => l.source === id || l.target === id)
    .flatMap((l) => {
      const node = nodes.find((n) => n.id === (l.source === id ? l.target : l.source))
      return node ? [{ node, count: l.count }] : []
    })
    .sort((a, b) => b.count - a.count)

/** @param {string} domain */
export const domainSuffix = (domain) => (domain === 'all' ? '' : ` · ${domain}`)

// Candidate trend against the previous window of the same length: `previous === 0` is a name
// that had no documents at all before, so it reads as "novo" rather than an infinite rise.
/** @param {{ count: number, previous: number }} c */
export const trendOf = (c) => {
  if (c.previous === 0) return { cls: 'up', text: 'novo' }
  if (c.count > c.previous) return { cls: 'up', text: '↑ era ' + fmt(c.previous) }
  if (c.count < c.previous) return { cls: '', text: '↓ era ' + fmt(c.previous) }
  return { cls: '', text: '= ' + fmt(c.previous) }
}

/** @param {string} c */
const hex = (c) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16))

// The middle of the ramp: a quiet grey, so "on the mean" reads as absence of signal next to
// the red and the green, not as a third colour.
export const SCALE_MID = '#8b909c'

// A signed value on the red/grey/green ramp, clamped to ±span. A null/NaN value renders
// transparent rather than a fake neutral color, so a doc with no signal never looks like it
// scored zero. With `fade`, the colour also thins out towards the middle (alpha .5 on the
// mean, opaque at the ends), so a map's neutral words recede and the coloured ones carry it.
/** @param {number | null | undefined} value @param {number} span @param {boolean} [fade] */
const scaleColor = (value, span, fade = false) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'transparent'
  const x = Math.max(-span, Math.min(span, Number(value)))
  const [from, to, k] = x < 0 ? [hex('#ff6b7d'), hex(SCALE_MID), (x + span) / span] : [hex(SCALE_MID), hex('#7ee787'), x / span]
  const rgb = from.map((v, i) => Math.round(v + (to[i] - v) * k)).join(',')
  const strength = Math.abs(x) / span
  return fade && strength < 1 ? `rgba(${rgb},${(0.5 + 0.5 * strength).toFixed(2)})` : `rgb(${rgb})`
}

// Tone is a GDELT-only signal (see CLAUDE.md); political news sits around -1, so ±3 is the
// visible range.
/** @param {number | null | undefined} t */
export const toneColor = (t) => scaleColor(t, 3)

// Testimony is kikori's -10..+10 score per (doc, person), from GET /api/people/:id/testimony.
// The model's own class cut is neg <= -2.5 / pos >= 2.5 (README, "The kikori contract"); the
// color saturates at twice that, where a row is unambiguously on one side.
export const TESTIMONY_CUT = 2.5

/** @param {number | null | undefined} s */
export const testimonyColor = (s) => scaleColor(s, 2 * TESTIMONY_CUT)

/** @param {number | null | undefined} s @returns {'negativo' | 'neutro' | 'positivo' | null} */
export const testimonyClass = (s) => {
  if (s === null || s === undefined || Number.isNaN(Number(s))) return null
  return Number(s) <= -TESTIMONY_CUT ? 'negativo' : Number(s) >= TESTIMONY_CUT ? 'positivo' : 'neutro'
}

// The map's colour mask: a term's colour is the distance between the mean score of the texts
// that carry it and the person's own mean over the same recorte, not the raw score. Every
// text about one person is shifted the same way by the name prior, so centring on the person
// cancels it and what remains is "the texts with this word are harsher/kinder than usual for
// this person". Saturates at MASK_SPAN either way: tighter than the class cut on purpose,
// because one person's terms sit within a point or so of that person's mean and a ±2.5 ramp
// painted them all the same grey. A term seen in fewer than MASK_MIN scored texts gets no
// colour rather than a noisy one.
export const MASK_MIN = 3
export const MASK_SPAN = 1.5

/** @param {number} delta */
export const maskColor = (delta) => scaleColor(delta, MASK_SPAN, true)

/** @param {{ testimony?: TermTestimony | null }} term @param {number | null | undefined} personScore @returns {string | null} */
export const termMask = (term, personScore) => {
  const t = term.testimony
  if (!t || t.n < MASK_MIN || personScore === null || personScore === undefined) return null
  return maskColor(t.score - personScore)
}

// Where a -10..+10 score sits on the panel's axis, as a percentage from the left edge.
/** @param {number} s */
export const testimonyPosition = (s) => ((Math.max(-10, Math.min(10, Number(s))) + 10) / 20) * 100

/** @param {unknown} value */
export const signed = (value) => (Number(value) > 0 ? '+' : '') + fmt(value)

// by_domain is one row per (domain, source); the strip and the focus line want one entry per
// outlet, so the rows of one domain fold into a text-weighted mean. Most texts first.
/** @param {TestimonyDomainRow[]} rows @returns {{ domain: string, sources: string[], score: number, n: number }[]} */
export const foldTestimonyDomains = (rows) => {
  /** @type {Map<string, { domain: string, sources: string[], sum: number, n: number }>} */
  const byDomain = new Map()
  for (const r of rows) {
    if (r.score === null || r.score === undefined || !r.n) continue
    const entry = byDomain.get(r.domain) ?? { domain: r.domain, sources: [], sum: 0, n: 0 }
    entry.sources.push(r.source)
    entry.sum += Number(r.score) * r.n
    entry.n += r.n
    byDomain.set(r.domain, entry)
  }
  return [...byDomain.values()].map(({ sum, ...e }) => ({ ...e, score: sum / e.n })).sort((a, b) => b.n - a.n || a.domain.localeCompare(b.domain))
}

// The picked outlet's own testimony. Null when no outlet is picked or the outlet never clears
// the route's `min` floor.
/** @param {TestimonyDomainRow[]} rows @param {string} domain @returns {{ score: number, n: number } | null} */
export const testimonyFocus = (rows, domain) => {
  const own = domain === 'all' ? undefined : foldTestimonyDomains(rows).find((d) => d.domain === domain)
  return own ? { score: own.score, n: own.n } : null
}

// Only the bsky.app profile/post URL a bluesky doc's `uri` (at://did/collection/rkey)
// maps to; every other source's doc has no equivalent shortcut and falls through to
// safeDocUrl's raw http(s) branch below.
/** @param {Doc | null | undefined} d */
export const bskyUrl = (d) => {
  try {
    if (!d || d.source !== 'bluesky' || !d.domain || typeof d.uri !== 'string' || !d.uri.startsWith('at://')) return null
    if (d.uri.endsWith('/')) return null
    const key = d.uri.split('/').pop()
    return key ? `https://bsky.app/profile/${encodeURIComponent(d.domain)}/post/${encodeURIComponent(key)}` : null
  } catch {
    return null
  }
}

/** @param {Doc} d */
export const safeDocUrl = (d) => {
  try {
    const bsky = bskyUrl(d)
    if (bsky) return bsky
    const url = new URL(String(d.uri))
    if (['http:', 'https:'].includes(url.protocol)) return url.href
  } catch {}
  return null
}
