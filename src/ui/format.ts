// Pure helpers: text formatting, labels and URL derivation. No DOM, no fetch, no mutable
// state, so every function here is directly importable and testable under node:test.
//
// This file also carries the client's shared type vocabulary; the other modules import the
// types from here, so `tsc` checks src/ui the same way it checks the rest of src/.

export type TermTestimony = { score: number; n: number }
export type Term = { id: string; term: string; kind: string; count: number; pmi: number; testimony?: TermTestimony | null }
export type Link = { source: string; target: string; count: number }
export type PersonTestimony = { method: string; score: number | null; n: number }
export type Graph = { person: { id: string; name: string }; stats?: { about?: number; testimony?: PersonTestimony }; nodes: Term[]; links: Link[] }
export type Doc = { source?: string; uri?: unknown; domain?: string | null; text?: string }
export type OutletRow = { domain?: string | null; source?: string | null; label?: string | null; docs: number; tone?: number | null }
export type Sample = { id: string; source: string; text: string }
export type Candidate = { name: string; count: number; sources: number; previous: number; samples: Sample[] }
export type TestimonyOverall = { score: number | null; n: number }
export type TestimonySourceRow = { source: string; score: number | null; n: number }
export type TestimonyDomainRow = { domain: string; source: string; score: number | null; n: number }
export type Testimony = { method: string; overall: TestimonyOverall; by_source: TestimonySourceRow[]; by_domain: TestimonyDomainRow[] }
export type Measure = (text: string, size: number, family?: string, weight?: number) => number
export type Box = { x: number; y: number; w: number; h: number }
export type CenterBox = Box & { lines: string[]; size: number; lineHeight: number; id?: string }
export type PlacedTerm = Term & Box & { rank: number; size: number; lines: string[]; lineHeight: number; score: number }
export type Point = { x: number; y: number }
export type Routing = { points: Point[]; ports: Map<string, number[]>; adjacent: { index: number; weight: number }[][] }
export type Layout = { placed: PlacedTerm[]; overflow: Term[]; center: CenterBox; routing?: Routing }
export type PersonRef = { id: string; name: string }
export type CompareSide = { count: number; pmi: number; tone: number | null }
export type CompareTerm = { term: string; kind: string; a: CompareSide | 'name' | null; b: CompareSide | 'name' | null }
export type Compare = { days: number; a: { person: PersonRef; about: number }; b: { person: PersonRef; about: number }; terms: CompareTerm[] }

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const esc = (value: unknown) => String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])

export const fmt = (value: unknown) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })

export const label = (n: { kind?: string; term: string }) => (n.kind === 'hashtag' ? '#' : '') + n.term

export const normalize = (s: unknown) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()

export const kinds: Record<string, string> = { word: 'Palavra', hashtag: 'Hashtag', phrase: 'Expressão' }

export const sourceLabels: Record<string, string> = {
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
// feeding one shared change handler (boot() in app.ts): a new source only needs an entry
// here plus its pt-BR label in sourceLabels, never a bespoke handler.
export const SOURCE_SEGMENTS: [string, string][] = [
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
export const score = (n: { pmi?: number; count?: number }, sort: string) =>
  sort === 'pmi' ? Number(n.pmi || 0) * Math.log1p(Number(n.count || 0)) : Number(n.count || 0)

export const scoreName = (sort: string) => (sort === 'pmi' ? 'PMI × ln(1 + docs)' : 'frequência em documentos')

export const matching = (n: { kind?: string; term: string }, query: unknown) => normalize(label(n)).includes(normalize(query))

export const relatedTo = (nodes: Term[], links: Link[], id: string | null): { node: Term; count: number }[] =>
  links
    .filter((l) => l.source === id || l.target === id)
    .flatMap((l) => {
      const node = nodes.find((n) => n.id === (l.source === id ? l.target : l.source))
      return node ? [{ node, count: l.count }] : []
    })
    .sort((a, b) => b.count - a.count)

export const domainSuffix = (domain: string) => (domain === 'all' ? '' : ` · ${domain}`)

// Candidate trend against the previous window of the same length: `previous === 0` is a name
// that had no documents at all before, so it reads as "novo" rather than an infinite rise.
export const trendOf = (c: { count: number; previous: number }) => {
  if (c.previous === 0) return { cls: 'up', text: 'novo' }
  if (c.count > c.previous) return { cls: 'up', text: '↑ era ' + fmt(c.previous) }
  if (c.count < c.previous) return { cls: '', text: '↓ era ' + fmt(c.previous) }
  return { cls: '', text: '= ' + fmt(c.previous) }
}

const hex = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16))

// One leg of a colour ramp: where it starts, where it ends, and how far along it we are.
type Ramp = [number[], number[], number]

const mix = (from: number[], to: number[], k: number) => from.map((v, i) => Math.round(v + (to[i] - v) * k)).join(',')

// The middle of the ramp: a quiet grey, so "on the mean" reads as absence of signal next to
// the red and the green, not as a third colour.
export const SCALE_MID = '#8b909c'

// A signed value on the red/grey/green ramp, clamped to ±span. A null/NaN value renders
// transparent rather than a fake neutral color, so a doc with no signal never looks like it
// scored zero. With `fade`, the colour also thins out towards the middle (alpha .5 on the
// mean, opaque at the ends), so a map's neutral words recede and the coloured ones carry it.
const scaleColor = (value: number | null | undefined, span: number, fade = false) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'transparent'
  const x = Math.max(-span, Math.min(span, Number(value)))
  const [from, to, k]: Ramp = x < 0 ? [hex('#ff6b7d'), hex(SCALE_MID), (x + span) / span] : [hex(SCALE_MID), hex('#7ee787'), x / span]
  const rgb = mix(from, to, k)
  const strength = Math.abs(x) / span
  return fade && strength < 1 ? `rgba(${rgb},${(0.5 + 0.5 * strength).toFixed(2)})` : `rgb(${rgb})`
}

// Tone is a GDELT-only signal (see CLAUDE.md); political news sits around -1, so ±3 is the
// visible range.
export const toneColor = (t: number | null | undefined) => scaleColor(t, 3)

// Testimony is kikori's -10..+10 score per (doc, person), from GET /api/people/:id/testimony.
// The model's own class cut is neg <= -2.5 / pos >= 2.5 (README, "The kikori contract"); the
// color saturates at twice that, where a row is unambiguously on one side.
const TESTIMONY_CUT = 2.5

export const testimonyColor = (s: number | null | undefined) => scaleColor(s, 2 * TESTIMONY_CUT)

export const testimonyClass = (s: number | null | undefined): 'negativo' | 'neutro' | 'positivo' | null => {
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

export const maskColor = (delta: number) => scaleColor(delta, MASK_SPAN, true)

// The ruler figure's own hue pair, one per side: not red/green (that pair already means
// hostile/favourable, from testimony) but a scoped, data-encoding exception to "one gold accent"
// the same way toneColor/maskColor already are. Kept in step with atlas.css's --cmp-a/--cmp-b.
const CMP_A_HEX = hex('#7fa8ff')
const CMP_B_HEX = hex('#ff9d6b')

// A signed position on the ruler, -1 (all A) to +1 (all B), on the same red/grey-analogue ramp
// shape as scaleColor: the middle is the same quiet SCALE_MID grey ("divided, no signal"), each
// end saturates into its own side's hue. balance = 0 returns SCALE_MID itself (not a computed
// near-grey), so a term piled dead centre reads exactly as "on the mean" does elsewhere.
export const balanceColor = (balance: number) => {
  const x = Math.max(-1, Math.min(1, Number(balance) || 0))
  if (x === 0) return SCALE_MID
  const mid = hex(SCALE_MID)
  const [from, to, k]: Ramp = x < 0 ? [CMP_A_HEX, mid, x + 1] : [mid, CMP_B_HEX, x]
  const rgb = mix(from, to, k)
  return `rgb(${rgb})`
}

export const termMask = (term: { testimony?: TermTestimony | null }, personScore: number | null | undefined): string | null => {
  const t = term.testimony
  if (!t || t.n < MASK_MIN || personScore === null || personScore === undefined) return null
  return maskColor(t.score - personScore)
}

// Where a -10..+10 score sits on the panel's axis, as a percentage from the left edge.
export const testimonyPosition = (s: number) => ((Math.max(-10, Math.min(10, Number(s))) + 10) / 20) * 100

export const signed = (value: unknown) => (Number(value) > 0 ? '+' : '') + fmt(value)

// by_domain is one row per (domain, source); the strip and the focus line want one entry per
// outlet, so the rows of one domain fold into a text-weighted mean. Most texts first.
export const foldTestimonyDomains = (rows: TestimonyDomainRow[]): { domain: string; sources: string[]; score: number; n: number }[] => {
  const byDomain = new Map<string, { domain: string; sources: string[]; sum: number; n: number }>()
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

// One row per outlet, from the two routes that know about outlets. /sources says how many
// documents the outlet published in the recorte (every outlet, no floor); /testimony says the
// kikori mean over the ones that were scored (only outlets clearing the route's `min`). They
// used to be two lists on the page, which meant reading the same outlet twice; merged, an
// outlet under the floor keeps its documents and simply has no mean. Most documents first,
// so the loudest outlets stay at the top the way /sources already ordered them.
export const mergeOutlets = (
  rows: OutletRow[],
  testimonyRows: TestimonyDomainRow[],
): { domain: string; sources: string[]; docs: number; score: number | null; n: number }[] => {
  const scored = new Map(foldTestimonyDomains(testimonyRows).map((d) => [d.domain, d]))
  const byDomain = new Map<string, { domain: string; sources: string[]; docs: number }>()
  for (const r of rows) {
    const domain = r.domain ?? r.source ?? ''
    if (!domain) continue
    const entry = byDomain.get(domain) ?? { domain, sources: [], docs: 0 }
    if (r.source && !entry.sources.includes(r.source)) entry.sources.push(r.source)
    entry.docs += r.docs
    byDomain.set(domain, entry)
  }
  return [...byDomain.values()]
    .map((e) => {
      const t = scored.get(e.domain)
      return { ...e, score: t ? t.score : null, n: t ? t.n : 0 }
    })
    .sort((a, b) => b.docs - a.docs || a.domain.localeCompare(b.domain))
}

// The picked outlet's own testimony. Null when no outlet is picked or the outlet never clears
// the route's `min` floor.
export const testimonyFocus = (rows: TestimonyDomainRow[], domain: string): { score: number; n: number } | null => {
  const own = domain === 'all' ? undefined : foldTestimonyDomains(rows).find((d) => d.domain === domain)
  return own ? { score: own.score, n: own.n } : null
}

// Only the bsky.app profile/post URL a bluesky doc's `uri` (at://did/collection/rkey)
// maps to; every other source's doc has no equivalent shortcut and falls through to
// safeDocUrl's raw http(s) branch below.
export const bskyUrl = (d: Doc | null | undefined) => {
  try {
    if (!d || d.source !== 'bluesky' || !d.domain || typeof d.uri !== 'string' || !d.uri.startsWith('at://')) return null
    if (d.uri.endsWith('/')) return null
    const key = d.uri.split('/').pop()
    return key ? `https://bsky.app/profile/${encodeURIComponent(d.domain)}/post/${encodeURIComponent(key)}` : null
  } catch {
    return null
  }
}

export const safeDocUrl = (d: Doc) => {
  try {
    const bsky = bskyUrl(d)
    if (bsky) return bsky
    const url = new URL(String(d.uri))
    if (['http:', 'https:'].includes(url.protocol)) return url.href
  } catch {}
  return null
}
