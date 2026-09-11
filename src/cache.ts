import { int } from './query.js'

const HOUR = 3600

// MAX_HOURS = one week; no env typo can pin a stale payload indefinitely.
const MAX_HOURS = 168

export type CacheWindows = { static: number; rolling: number; trend: number; swr: number }

// Hours in, seconds out; unset/non-numeric falls back to the default.
export const cacheWindows = (env: NodeJS.ProcessEnv = process.env): CacheWindows => ({
  static: int(env.API_CACHE_STATIC_HOURS, 24, 1, MAX_HOURS) * HOUR,
  rolling: int(env.API_CACHE_HOURS, 6, 1, MAX_HOURS) * HOUR,
  trend: int(env.API_CACHE_TREND_HOURS, 1, 1, MAX_HOURS) * HOUR,
  swr: int(env.API_CACHE_SWR_HOURS, 24, 0, MAX_HOURS) * HOUR,
})

const apiCacheWindows = cacheWindows()

export const NO_STORE = 'no-store'

// rising and candidates default to days:7 and read as "lately" — shortest window.
const TREND = new Set(['rising', 'candidates'])

// /api/people has no now() in its SQL: never stale between two pnpm push runs.
const tierOf = (path: string): Exclude<keyof CacheWindows, 'swr'> => {
  const last = path.split('/').filter(Boolean).pop() ?? ''
  return last === 'people' ? 'static' : TREND.has(last) ? 'trend' : 'rolling'
}

export type CacheSubject = { method: string; path: string; status: number }

// Only a GET 200 is public and repeatable; 404s and 500s must not be cached.
export const cacheControl = ({ method, path, status }: CacheSubject, w: CacheWindows = apiCacheWindows): string => {
  if (method !== 'GET' || status !== 200) return NO_STORE
  const swr = w.swr ? `, stale-while-revalidate=${w.swr}` : ''
  return `public, s-maxage=${w[tierOf(path)]}${swr}`
}
