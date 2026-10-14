import seedJson from '../seed.json' with { type: 'json' }
import { percentile, round } from './perf.js'
import { endpoint, params, sourcesParams, testimonyParams } from './ui/api.js'
import type { Person } from './types.js'

// The recortes the page asks for on its own, one per person and window, built with the same
// functions the figures use so the querystring (and so the CDN cache key) is byte-identical.
// the atlas page's (web/routes/+page.svelte) defaults: sort pmi, 18 words, all sources, at each of the two windows.
export const WARM_DAYS = ['7', '21'] as const

export const warmPaths = (people: Pick<Person, 'id'>[], days: readonly string[] = WARM_DAYS): string[] => [
  '/api/people',
  ...people.flatMap((p) =>
    days.flatMap((d) => {
      const opts = { days: d, sort: 'pmi', limit: '18', source: 'all' }
      return [
        endpoint(p.id) + '/graph?' + params(opts),
        endpoint(p.id) + '/sources?' + sourcesParams(opts),
        endpoint(p.id) + '/testimony?' + testimonyParams(opts),
      ]
    }),
  ),
]

export type WarmResult = { path: string; status: number | null; cache: string | null; server: string | null; store: string; ms: number }

// A plain GET: no request header bypasses Vercel's CDN, so the workflows delete the `api`
// tag first (CACHE_TAG in cache.ts) and this refills what the page asks for. The store-only
// header makes a stored recorte's miss a 503 instead of the live statement: a broken warm store
// then shows up as a failed warm, not as dozens of slow origin computations.
export const WARM_HEADERS = { accept: 'application/json', 'x-warm-store-only': '1' } as const

const one = async (site: string, path: string, fetchFn: typeof fetch): Promise<WarmResult> => {
  const started = performance.now()
  try {
    const res = await fetchFn(site + path, { headers: WARM_HEADERS })
    await res.arrayBuffer()
    return { path, status: res.status, cache: res.headers.get('x-vercel-cache'), server: res.headers.get('server-timing'), store: res.headers.get('x-warm-store') ?? 'none', ms: performance.now() - started }
  } catch {
    return { path, status: null, cache: null, server: null, store: 'none', ms: performance.now() - started }
  }
}

// A few lanes, never a burst: the origin behind a MISS is the slow part this exists to hide.
export const warm = async (site: string, paths: string[], lanes = 2, fetchFn: typeof fetch = fetch): Promise<WarmResult[]> => {
  const queue = [...paths]
  const results: WarmResult[] = []
  const lane = async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) results.push(await one(site, next, fetchFn))
  }
  await Promise.all(Array.from({ length: Math.max(1, lanes) }, lane))
  return results
}

export const summary = (results: WarmResult[]) => {
  const by = (key: (r: WarmResult) => string) => results.reduce<Record<string, number>>((acc, r) => ((acc[key(r)] = (acc[key(r)] ?? 0) + 1), acc), {})
  const ms = results.map((r) => r.ms)
  return { requests: results.length, status: by((r) => String(r.status)), cache: by((r) => r.cache ?? 'none'), store: by((r) => r.store), p50: round(percentile(ms, 50)), p95: round(percentile(ms, 95)) }
}

// A CDN HIT replays the x-warm-store the origin set when it filled the cache, so a fallback body
// cached between the purge and this warm is not a broken store: only an origin answer is judged.
export const warmFailed = (results: WarmResult[]): boolean =>
  results.some((r) => r.status === null || r.status >= 500 || ((r.store === 'stale' || r.store === 'miss') && r.cache !== 'HIT'))

const main = async () => {
  const site = (process.env.SITE_URL ?? 'https://rashomon-five.vercel.app').replace(/\/$/, '')
  const results = await warm(site, warmPaths(seedJson as Person[]))
  const s = summary(results)
  console.log(`warmed ${s.requests} paths on ${site}: status ${JSON.stringify(s.status)}, cache ${JSON.stringify(s.cache)}, store ${JSON.stringify(s.store)}, p50 ${s.p50} ms, p95 ${s.p95} ms`)
  for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 5)) console.log(`  ${round(r.ms)} ms ${r.cache ?? '-'} ${r.status ?? 'ERR'} ${r.path}${r.server ? ' ' + r.server : ''}`)
  if (warmFailed(results)) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
