// Bundled directly (esbuild's JSON loader), never through src/outlets.ts, so src/ui keeps its
// own import direction and never pulls in a server-only module.
import outletsJson from '../../outlets.json' with { type: 'json' }

export type TermTestimony = { score: number; n: number }
// `community` is a plain number: src/communities.ts's Louvain/graphology types never reach the UI.
export type Term = { id: string; term: string; kind: string; count: number; pmi: number; testimony?: TermTestimony | null; community?: number | null }
export type Link = { source: string; target: string; count: number }
export type PersonTestimony = { method: string; score: number | null; n: number }
export type Graph = { person: { id: string; name: string }; stats?: { about?: number; testimony?: PersonTestimony }; nodes: Term[]; links: Link[] }
export type Doc = { source?: string; uri?: unknown; domain?: string | null; text?: string }
// field/neighbors (issue #218): from the window's own aggregate build, not the live query.
export type OutletNeighbor = { domain: string; similarity: number }
export type OutletRow = {
  domain?: string | null
  source?: string | null
  label?: string | null
  docs: number
  tone?: number | null
  field?: number | null
  neighbors?: OutletNeighbor[]
}
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
export type CompareTerm = { term: string; kind: string; a: CompareSide | 'name' | null; b: CompareSide | 'name' | null; bridge?: number }
export type Compare = { days: number; a: { person: PersonRef; about: number }; b: { person: PersonRef; about: number }; terms: CompareTerm[] }

// Mirrors src/query.ts's BRIDGE_NODES and graph.ts's bridgeNodes: the most-documented terms,
// never an own name, sorted so the bridges URL is one cache key per recorte.
export const BRIDGE_NODES = 60

const sideDocs = (v: CompareSide | 'name' | null) => (v && v !== 'name' ? v.count : 0)

export const bridgeIds = (terms: readonly CompareTerm[]) =>
  terms
    .filter((t) => t.a !== 'name' && t.b !== 'name')
    .map((t) => ({ id: `${t.kind}:${t.term}`, docs: sideDocs(t.a) + sideDocs(t.b) }))
    .sort((x, y) => y.docs - x.docs || x.id.localeCompare(y.id))
    .slice(0, BRIDGE_NODES)
    .map((t) => t.id)
    .sort()

export const hasBridges = (terms: readonly CompareTerm[]) => terms.some((t) => t.bridge !== undefined)

// In place on purpose: a figure tells a new dataset from a repaint by object identity, so the
// scores join the payload already on screen (and in the scope memo) instead of replacing it.
export const applyBridges = (terms: CompareTerm[], bridges: Record<string, number>) => {
  for (const t of terms) t.bridge = bridges[`${t.kind}:${t.term}`] ?? 0
}
export type RisingTerm = { term: string; kind: string; count_recent: number; count_baseline: number; count_recent_raw: number; count_baseline_raw: number; lift: number }
// `present` and `about.words_*` are optional on the page side only: a payload cached before they
// existed still has to paint something rather than NaN positions.
export type RisingAbout = { recent: number; baseline: number; words_recent?: number; words_baseline?: number }
export type Rising = { days: number; baseline: number; terms: RisingTerm[]; present?: RisingTerm[]; outlets: string[]; about: RisingAbout }
export type WeekTerm = { term: string; kind: string; count: number }
export type WeekBucket = { start: string; about: number; terms: WeekTerm[] }
export type Week = { days: number; tz: string; buckets: WeekBucket[] }
// /api/agenda (issue #208): one row per top domain, one cell per (person, domain) pair that
// has at least one tracked doc there. `share` is relative to the domain's own tracked
// coverage, so a domain with docs naming two tracked people can sum above 1 across its cells.
export type AgendaCell = { person_id: string; domain: string; docs: number; share: number }
export type Agenda = { days: number; persons: PersonRef[]; domains: string[]; cells: AgendaCell[] }

// /api/comention (issue #207): spans every tracked person, no single `person`. A pair below
// `min`, or with zero shared docs, is simply absent from `pairs`, never a zero-count row.
export type ComentionPerson = { id: string; name: string }
export type ComentionPair = { a: string; b: string; count: number }
export type Comention = { days: number; persons: ComentionPerson[]; pairs: ComentionPair[] }
// The raw token /api/people/:id/lenses echoes back, normalized: domain:<host>, lean:<value>,
// source:<name>, or the fallback 'all'. CompareTerm is reused as-is for `terms`: the API's
// per-term { term, kind, a, b } shape is identical to /compare's.
export type Lens = string
export type LensSide = { lens: Lens; about: number }
export type Lenses = { days: number; a: LensSide; b: LensSide; terms: CompareTerm[] }
// The inspector's own 7-bar sparkline (issue #147): 'loading' paints a ghost, 'ready' the
// counts /timeline returned, 'error' leaves the hole empty rather than inventing bars.
export type SparklineState = 'loading' | 'ready' | 'error'
export type Sparkline = { state: SparklineState; counts?: number[] }
// Figure 7 (issue #216): two independently-scaled series sharing one day axis. Field names
// never overlap (views vs count) so neither reads as sharing the other's scale.
export type AttentionDay = { day: string; views: number }
export type Attention = { days: number; series: AttentionDay[] }
export type AttentionMentionDay = { day: string; count: number }

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

const esc = (value: unknown) => String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])

// Html is safe for innerHTML. Only `html` and `raw` produce one; the tag escapes every
// interpolation that is not already Html, joins arrays, and drops null/undefined.
const HTML_BRAND: unique symbol = Symbol('html')
export type Html = { readonly [HTML_BRAND]: true; toString(): string }

export const isHtml = (value: unknown): value is Html => typeof value === 'object' && value !== null && HTML_BRAND in value

export const raw = (markup: string): Html => ({ [HTML_BRAND]: true, toString: () => markup })

const piece = (value: unknown): string =>
  isHtml(value) ? String(value) : Array.isArray(value) ? value.map(piece).join('') : value === null || value === undefined ? '' : esc(value)

export const html = (strings: TemplateStringsArray, ...values: unknown[]): Html =>
  raw(strings.reduce((out, s, i) => out + s + (i < values.length ? piece(values[i]) : ''), ''))

export const fmt = (value: unknown) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })

export const label = (n: { kind?: string; term: string }) => (n.kind === 'hashtag' ? '#' : '') + n.term

export const normalize = (s: unknown) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()

// /week's bucket.start is already a BRT calendar day's own midnight; both helpers read it back
// through the same timezone rather than trusting the reader's local clock.
const WEEK_TZ = 'America/Sao_Paulo'

export const weekDayIso = (startIso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: WEEK_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(startIso))

// "seg 8": weekday abbreviation, no trailing period, plus the day of month. Never a year or
// month, since every bucket is inside the last 7 (or 30/60) days.
export const weekDayLabel = (startIso: string) => {
  const d = new Date(startIso)
  const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: WEEK_TZ, weekday: 'short' }).format(d).replace(/\.$/, '')
  const day = new Intl.DateTimeFormat('pt-BR', { timeZone: WEEK_TZ, day: 'numeric' }).format(d)
  return `${weekday} ${day}`
}

export const kinds: Record<string, string> = { word: 'Palavra', hashtag: 'Hashtag', phrase: 'Expressão', org: 'Organização' }

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

// sort='pmi' orders by pmi * ln(1 + count), matching src/graph.ts's sort=pmi so node sizing
// never drifts from the server's ordering.
export const score = (n: { pmi?: number; count?: number }, sort: string) =>
  sort === 'pmi' ? Number(n.pmi || 0) * Math.log1p(Number(n.count || 0)) : Number(n.count || 0)

export const scoreName = (sort: string) => (sort === 'pmi' ? 'PMI × ln(1 + docs)' : 'frequência em documentos')

export const LEAN_LABELS: Record<string, string> = { left: 'Esquerda', center: 'Centro', right: 'Direita' }

// Turns a lens token (echoed back by /api/people/:id/lenses, always normalized) into the prose
// the ruler's own end labels and #lensesStatus need: a domain's bare host, a lean's pt-BR name,
// a source's own label, or "Tudo" for the 'all' fallback.
export const lensLabel = (lens: Lens): string => {
  if (lens === 'all') return 'Tudo'
  const [prefix, value] = [lens.slice(0, lens.indexOf(':')), lens.slice(lens.indexOf(':') + 1)]
  if (prefix === 'domain') return value
  if (prefix === 'lean') return LEAN_LABELS[value] ?? value
  if (prefix === 'source') return sourceLabels[value] ?? value
  return lens
}

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

// The comention matrix's column head, since a column is too narrow for a full name: one letter
// per word of the name, up to three, upper case. The row head and the docs card still carry the
// full name, so identity never depends on this abbreviation being unique.
export const personInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase()

export const trendOf = (c: { count: number; previous: number }) => {
  if (c.previous === 0) return { cls: 'up', text: 'novo' }
  if (c.count > c.previous) return { cls: 'up', text: '↑ era ' + fmt(c.previous) }
  if (c.count < c.previous) return { cls: '', text: '↓ era ' + fmt(c.previous) }
  return { cls: '', text: '= ' + fmt(c.previous) }
}

const hex = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16))

type Ramp = [number[], number[], number]

const mix = (from: number[], to: number[], k: number) => from.map((v, i) => Math.round(v + (to[i] - v) * k)).join(',')

// Quiet grey for "on the mean": absence of signal, not a third colour.
export const SCALE_MID = '#8b909c'

// Null/NaN renders transparent rather than a fake neutral.
// With `fade`, alpha thins toward the middle so neutral words recede.
const scaleColor = (value: number | null | undefined, span: number, fade = false) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'transparent'
  const x = Math.max(-span, Math.min(span, Number(value)))
  const [from, to, k]: Ramp = x < 0 ? [hex('#ff7a8a'), hex(SCALE_MID), (x + span) / span] : [hex(SCALE_MID), hex('#74dc86'), x / span]
  const rgb = mix(from, to, k)
  const strength = Math.abs(x) / span
  return fade && strength < 1 ? `rgba(${rgb},${(0.5 + 0.5 * strength).toFixed(2)})` : `rgb(${rgb})`
}

export const toneColor = (t: number | null | undefined) => scaleColor(t, 3)

const TESTIMONY_CUT = 2.5

export const testimonyColor = (s: number | null | undefined) => scaleColor(s, 2 * TESTIMONY_CUT)

export const testimonyClass = (s: number | null | undefined): 'negativo' | 'neutro' | 'positivo' | null => {
  if (s === null || s === undefined || Number.isNaN(Number(s))) return null
  return Number(s) <= -TESTIMONY_CUT ? 'negativo' : Number(s) >= TESTIMONY_CUT ? 'positivo' : 'neutro'
}

// Colour by distance from person's mean: "texts carrying this word are harsher/kinder than
// usual for this person". A term seen in fewer than MASK_MIN scored texts gets no colour.
// MASK_SPAN is tighter than the model's ±2.5 class cut: one person's terms sit within ~1
// point of her mean, so a ±2.5 ramp painted them all grey.
export const MASK_MIN = 3
export const MASK_SPAN = 1.5

export const maskColor = (delta: number) => scaleColor(delta, MASK_SPAN, true)

// Kept in step with atlas.css's --cmp-a/--cmp-b.
const CMP_A_HEX = hex('#7fa8ff')
const CMP_B_HEX = hex('#ff9d6b')

// balance = 0 returns SCALE_MID itself so a term dead centre reads as "on the mean".
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

export type MaskState = 'avaliacao' | 'tema' | 'off'

// Top 6 by node count, ties broken by ascending id; a 7th+ community is simply absent from the map.
export const communityRanking = (nodes: { community?: number | null }[]): Map<number, number> => {
  const counts = new Map<number, number>()
  for (const n of nodes) {
    if (n.community === null || n.community === undefined) continue
    counts.set(n.community, (counts.get(n.community) ?? 0) + 1)
  }
  return new Map([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 6).map(([community], i) => [community, i + 1]))
}

// A discrete bucket needs no interpolation: a CSS token, not a computed rgb(...) string.
export const themeMask = (term: { community?: number | null }, ranking: Map<number, number>): string | null => {
  const c = term.community
  if (c === null || c === undefined) return null
  const rank = ranking.get(c)
  return rank === undefined ? null : `var(--theme-${rank})`
}

export const testimonyPosition = (s: number) => ((Math.max(-10, Math.min(10, Number(s))) + 10) / 20) * 100

export const signed = (value: unknown) => (Number(value) > 0 ? '+' : '') + fmt(value)

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

// Joins /sources doc counts and /testimony means into one list. An outlet under the
// floor keeps its doc count and has no mean.
export const mergeOutlets = (
  rows: OutletRow[],
  testimonyRows: TestimonyDomainRow[],
): { domain: string; sources: string[]; docs: number; score: number | null; n: number; field: number | null; neighbors: OutletNeighbor[] }[] => {
  const scored = new Map(foldTestimonyDomains(testimonyRows).map((d) => [d.domain, d]))
  const byDomain = new Map<string, { domain: string; sources: string[]; docs: number; field: number | null; neighbors: OutletNeighbor[] }>()
  for (const r of rows) {
    const domain = r.domain ?? r.source ?? ''
    if (!domain) continue
    const entry = byDomain.get(domain) ?? { domain, sources: [], docs: 0, field: null, neighbors: [] }
    if (entry.field === null && r.field != null) entry.field = r.field
    if (!entry.neighbors.length && r.neighbors?.length) entry.neighbors = r.neighbors
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

export const testimonyFocus = (rows: TestimonyDomainRow[], domain: string): { score: number; n: number } | null => {
  const own = domain === 'all' ? undefined : foldTestimonyDomains(rows).find((d) => d.domain === domain)
  return own ? { score: own.score, n: own.n } : null
}

type OutletEntry = { domain: string; lean: keyof typeof LEAN_LABELS }
const LEAN_BY_DOMAIN = new Map((outletsJson as OutletEntry[]).map((o) => [o.domain, o.lean]))

export const leanFor = (domain: string): string | null => LEAN_BY_DOMAIN.get(domain) ?? null

// Figure 8's grid shape: domains in the route's own order, cells keyed by person id so a
// missing pair reads as a blank cell rather than a zero share.
export const agendaRows = (data: Agenda): { domain: string; lean: string | null; cells: Map<string, AgendaCell> }[] => {
  const byDomain = new Map<string, Map<string, AgendaCell>>()
  for (const c of data.cells) {
    const cells = byDomain.get(c.domain) ?? new Map<string, AgendaCell>()
    cells.set(c.person_id, c)
    byDomain.set(c.domain, cells)
  }
  return data.domains.map((domain) => ({ domain, lean: leanFor(domain), cells: byDomain.get(domain) ?? new Map() }))
}

// bsky.app URL for a bluesky doc's at:// URI; every other source falls through to safeDocUrl.
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
