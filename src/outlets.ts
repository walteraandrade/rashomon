import outletsJson from '../outlets.json' with { type: 'json' }

export type Lean = 'left' | 'right' | 'center'
export type Basis = 'self_declared' | 'third_party_consensus'
export type Outlet = { domain: string; lean: Lean; basis: Basis; note: string; sources: string[] }
export type OutletLabel = { domain: string; lean: Lean; basis: Basis }

// outlets.json is metadata about a source, never about a document: read-only, never
// written into the docs table, resolved fresh on every request.
export const OUTLETS: Outlet[] = outletsJson as Outlet[]

export const LEANS: Lean[] = ['left', 'right', 'center']

const label = ({ domain, lean, basis }: Outlet): OutletLabel => ({ domain, lean, basis })

// Resolves the effective domain scope for a request from its already-normalized `domain`
// (a comma-joined list or 'all') and `lean` (a comma-joined list of left/right/center or
// 'all') query params. When lean is 'all', domain passes through unchanged — today's
// behaviour, no outlets echoed. Otherwise the two filters intersect: an unlabeled domain
// never matches any lean, and a domain narrower than the lean set is respected. An empty
// intersection is encoded as '' rather than 'all', so scopeCte's `d.domain = any(string_to_array($4, ','))`
// matches zero rows without a SQL-side special case.
export const resolveScope = (domain: string, lean: string): { domain: string; outlets: OutletLabel[] } => {
  if (lean === 'all') return { domain, outlets: [] }
  const leanTokens = lean.split(',')
  const leanOutlets = OUTLETS.filter((o) => leanTokens.includes(o.lean))
  const domainTokens = domain === 'all' ? null : domain.split(',')
  const scoped = domainTokens ? leanOutlets.filter((o) => domainTokens.includes(o.domain)) : leanOutlets
  return {
    domain: scoped.length ? scoped.map((o) => o.domain).join(',') : '',
    outlets: scoped.map(label),
  }
}

// Per-domain lookup used to annotate sourcesFor's rows: null when the row's domain is
// absent from outlets.json, populated regardless of whether lean was passed.
const byDomain = new Map(OUTLETS.map((o) => [o.domain, o]))
export const labelFor = (domain: string | null): { lean: Lean | null; basis: Basis | null } => {
  const outlet = domain ? byDomain.get(domain) : undefined
  return { lean: outlet?.lean ?? null, basis: outlet?.basis ?? null }
}
