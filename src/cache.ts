import { int } from './query.js'

const HOUR = 3600

// A week. Nothing in this repo justifies holding a response longer than that, and it keeps a
// typo in an environment variable from pinning a stale payload for months.
const MAX_HOURS = 168

export type CacheWindows = { static: number; rolling: number; trend: number; swr: number }

// Hours in, seconds out. Every knob has a default, a floor and a ceiling, like the query
// parsers: an unset, empty or non-numeric value falls back to the default.
export const cacheWindows = (env: NodeJS.ProcessEnv = process.env): CacheWindows => ({
  static: int(env.API_CACHE_STATIC_HOURS, 24, 1, MAX_HOURS) * HOUR,
  rolling: int(env.API_CACHE_HOURS, 6, 1, MAX_HOURS) * HOUR,
  trend: int(env.API_CACHE_TREND_HOURS, 1, 1, MAX_HOURS) * HOUR,
  swr: int(env.API_CACHE_SWR_HOURS, 24, 0, MAX_HOURS) * HOUR,
})

const apiCacheWindows = cacheWindows()

export const NO_STORE = 'no-store'

// Both default to days:7 and are read as "what changed lately", so they get the shortest
// window; everything else defaults to days:30 or wider.
const TREND = new Set(['rising', 'candidates'])

// /api/people is the only route with no now() in its SQL, so nothing about it goes stale
// between two `pnpm push` runs.
const tierOf = (path: string): Exclude<keyof CacheWindows, 'swr'> => {
  const last = path.split('/').filter(Boolean).pop() ?? ''
  return last === 'people' ? 'static' : TREND.has(last) ? 'trend' : 'rolling'
}

export type CacheSubject = { method: string; path: string; status: number }

// Only a 200 on a GET is public and repeatable. A 404 (unknown person, unknown route) or a
// 500 must never sit in a shared cache for hours, so it is explicitly not stored.
export const cacheControl = ({ method, path, status }: CacheSubject, w: CacheWindows = apiCacheWindows): string => {
  if (method !== 'GET' || status !== 200) return NO_STORE
  const swr = w.swr ? `, stale-while-revalidate=${w.swr}` : ''
  return `public, s-maxage=${w[tierOf(path)]}${swr}`
}
