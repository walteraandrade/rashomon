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
  const [from, to, k]: Ramp = x < 0 ? [hex('#ff6b7d'), hex(SCALE_MID), (x + span) / span] : [hex(SCALE_MID), hex('#7ee787'), x / span]
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

export const testimonyFocus = (rows: TestimonyDomainRow[], domain: string): { score: number; n: number } | null => {
  const own = domain === 'all' ? undefined : foldTestimonyDomains(rows).find((d) => d.domain === domain)
  return own ? { score: own.score, n: own.n } : null
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
