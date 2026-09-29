import { createHash } from 'node:crypto'
import { db } from './db.js'
import type { GraphQuery, TestimonyQuery } from './graph.js'
import { parseQuery, parseTestimonyQuery } from './query.js'
import { warmPaths, WARM_DAYS } from './warm.js'

export type WarmRoute = 'graph' | 'sources' | 'testimony'

export type WarmReader = { get: (pathname: string, key: string) => Promise<string | null> }
export type WarmWriter = { put: (pathname: string, text: string) => Promise<void> }
export type WarmStore = WarmReader & WarmWriter

export type WarmState = 'hit' | 'stale' | 'miss'

export const READ_TIMEOUT_MS = 2000

const PARSERS: Record<WarmRoute, (q: Record<string, string | undefined>) => GraphQuery | TestimonyQuery> = {
  graph: parseQuery,
  sources: parseQuery,
  testimony: parseTestimonyQuery,
}

const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, stable(v)]))
      : value

// The whole parser output, so two querystrings that parse alike share a key and a parameter the
// parser keeps (method, communities, country...) can never share one across different bodies.
export const storeKey = (route: WarmRoute, parsed: object): string =>
  createHash('sha256').update(JSON.stringify(stable({ route, query: parsed }))).digest('hex')

export const pathnameOf = (personId: string, route: WarmRoute, key: string) => `warm/v1/${encodeURIComponent(personId)}/${route}/${key}.json`

export type WarmRecorte = { personId: string; route: WarmRoute; days: number; path: string; parsed: GraphQuery | TestimonyQuery; key: string; pathname: string }

// One recorte per non-people path warmPaths lists, so the store and the CDN warm the same set.
export const warmRecortes = (people: { id: string }[], days: readonly string[] = WARM_DAYS): WarmRecorte[] =>
  warmPaths(people, days)
    .filter((path) => path !== '/api/people')
    .map((path) => {
      const url = new URL(path, 'http://warm.local')
      const segments = url.pathname.split('/')
      const route = segments[segments.length - 1] as WarmRoute
      const personId = decodeURIComponent(segments[3])
      const parsed = PARSERS[route](Object.fromEntries(url.searchParams))
      const key = storeKey(route, parsed)
      return { personId, route, days: parsed.days, path, parsed, key, pathname: pathnameOf(personId, route, key) }
    })

// The key of a warm recorte for this route, or null when the parsed query is not one of them.
// Recomputed per call: `method` follows TESTIMONY_DTYPE/TESTIMONY_REVISION at parse time.
export const eligibleKey = (route: WarmRoute, parsed: object): string | null => {
  const key = storeKey(route, parsed)
  return warmRecortes([{ id: '_' }]).some((r) => r.route === route && r.key === key) ? key : null
}

export const entryText = (key: string, body: string) => `${key}\n${body}`

export const splitEntry = (text: string): { key: string; body: string } | null => {
  const at = text.indexOf('\n')
  return at <= 0 ? null : { key: text.slice(0, at), body: text.slice(at + 1) }
}

export type ScopeRow = { built_at: string; about: number }

export const scopeRow = async (personId: string, days: number): Promise<ScopeRow | null> => {
  const { rows } = await db.query<ScopeRow>(
    `select built_at::text as built_at, about from graph_scopes where days = $1 and source = 'all' and person_id = $2`,
    [days, personId],
  )
  return rows[0] ?? null
}

export type Lookup = { state: WarmState; body: string | null }

// Any failure is a miss: the store is an accelerator, never a dependency.
export const lookup = async (store: WarmReader, r: { personId: string; route: WarmRoute; key: string; days: number }): Promise<Lookup> => {
  try {
    const scope = await scopeRow(r.personId, r.days)
    if (!scope) return { state: 'miss', body: null }
    const text = await store.get(pathnameOf(r.personId, r.route, r.key), scope.built_at)
    const entry = text === null ? null : splitEntry(text)
    if (!entry) return { state: 'miss', body: null }
    return entry.key === scope.built_at ? { state: 'hit', body: entry.body } : { state: 'stale', body: null }
  } catch {
    return { state: 'miss', body: null }
  }
}

// setTimeout raced against the whole fetch, never AbortSignal.timeout: a timer the test clock drives.
const within = <T>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('warm store timeout')), ms)
    work.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    )
  })

// The public object read as `${base}/${pathname}?v=<built_at>`: the query string makes every build
// its own CDN key, so an overwritten object is never read from an older cached copy.
export const blobReader = (base: string, fetchFn: typeof fetch = (...args) => fetch(...args), timeoutMs = READ_TIMEOUT_MS): WarmReader => ({
  get: async (pathname, key) => {
    try {
      return await within(
        (async () => {
          const res = await fetchFn(`${base.replace(/\/+$/, '')}/${pathname}?v=${encodeURIComponent(key)}`)
          return res.status === 200 ? await res.text() : null
        })(),
        timeoutMs,
      )
    } catch {
      return null
    }
  },
})

export const warmStoreFromEnv = (env: Record<string, string | undefined>): WarmReader | null => {
  const base = (env.WARM_STORE_URL ?? '').trim()
  return base ? blobReader(base) : null
}

export type MemoryWarmStore = WarmStore & { entries: Map<string, string> }

export const memoryWarmStore = (): MemoryWarmStore => {
  const entries = new Map<string, string>()
  return {
    entries,
    get: async (pathname) => entries.get(pathname) ?? null,
    put: async (pathname, text) => void entries.set(pathname, text),
  }
}
