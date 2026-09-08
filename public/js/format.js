// Pure helpers: text formatting, labels and URL derivation. No DOM, no fetch, no mutable
// state, so every function here is directly importable and testable under node:test.

export const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export const fmt = (value) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })

export const label = (n) => (n.kind === 'hashtag' ? '#' : '') + n.term

export const normalize = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()

export const kinds = { word: 'Palavra', hashtag: 'Hashtag', theme: 'Tema' }

export const sourceLabels = {
  all: 'todas as fontes',
  bluesky: 'Bluesky',
  gdelt: 'GDELT',
  rss: 'RSS',
  gnews: 'Google News',
  gkg: 'GKG',
  camara: 'Câmara',
  senado: 'Senado',
}

// The segSource segmented-control buttons, [value, compact pt-BR label]. One shared list
// feeding one shared click handler (buildSeg in design-5.html): a new source only needs an
// entry here, never a bespoke handler.
export const SOURCE_SEGMENTS = [
  ['all', 'todas'],
  ['bluesky', 'bluesky'],
  ['gdelt', 'gdelt'],
  ['rss', 'rss'],
  ['gnews', 'g.news'],
  ['gkg', 'gkg'],
  ['camara', 'câmara'],
  ['senado', 'senado'],
]

// sort='pmi' orders by pmi * ln(1 + count), matching src/graph.ts's sort=pmi contract on
// purpose, so the client's node sizing never drifts from the server's own ordering.
export const score = (n, sort) => (sort === 'pmi' ? Number(n.pmi || 0) * Math.log1p(Number(n.count || 0)) : Number(n.count || 0))

export const scoreName = (sort) => (sort === 'pmi' ? 'PMI × ln(1 + docs)' : 'frequência em documentos')

export const matching = (n, query) => normalize(label(n)).includes(normalize(query))

export const relatedTo = (nodes, links, id) =>
  links
    .filter((l) => l.source === id || l.target === id)
    .map((l) => ({ node: nodes.find((n) => n.id === (l.source === id ? l.target : l.source)), count: l.count }))
    .filter((r) => r.node)
    .sort((a, b) => b.count - a.count)

export const domainSuffix = (domain) => (domain === 'all' ? '' : ` · ${domain}`)

const hex = (c) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16))

// Tone is a GDELT-only signal (see CLAUDE.md); a null/NaN tone renders transparent rather
// than a fake neutral color, so a doc with no tone never looks like it scored zero.
export const toneColor = (t) => {
  if (t === null || t === undefined || Number.isNaN(Number(t))) return 'transparent'
  const x = Math.max(-3, Math.min(3, Number(t)))
  const [from, to, k] = x < 0 ? [hex('#ff6b7d'), hex('#626a8c'), (x + 3) / 3] : [hex('#626a8c'), hex('#7ee787'), x / 3]
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * k)).join(',')})`
}

// Only the bsky.app profile/post URL a bluesky doc's `uri` (at://did/collection/rkey)
// maps to; every other source's doc has no equivalent shortcut and falls through to
// safeDocUrl's raw http(s) branch below.
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

export const safeDocUrl = (d) => {
  try {
    const bsky = bskyUrl(d)
    if (bsky) return bsky
    const url = new URL(d.uri)
    if (['http:', 'https:'].includes(url.protocol)) return url.href
  } catch {}
  return null
}
