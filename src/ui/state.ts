// Bounded TTL memo of successful API responses, one bucket per scope so a sort change does
// not evict the outlet list. Only resolved values are written. Shared across figures: every
// key embeds the person id and full querystring, so two figures never collide.
export const SCOPE_TTL_MS = 20_000
export const SCOPE_LIMIT = 8

type Entry = { at: number; value: unknown }

const scopes = new Map<string, Map<string, Entry>>()

const bucket = (scope: string) => {
  const found = scopes.get(scope)
  if (found) return found
  const fresh = new Map<string, Entry>()
  scopes.set(scope, fresh)
  return fresh
}

// Returns a one-element box on a hit, null on a miss.
export const readScope = (scope: string, key: string, now = Date.now()) => {
  const entry = bucket(scope).get(key)
  if (!entry) return null
  if (now - entry.at > SCOPE_TTL_MS) {
    bucket(scope).delete(key)
    return null
  }
  return { value: entry.value }
}

export const writeScope = (scope: string, key: string, value: unknown, now = Date.now()) => {
  const entries = bucket(scope)
  entries.delete(key)
  entries.set(key, { at: now, value })
  // Insertion order is eviction order: the oldest write goes first.
  while (entries.size > SCOPE_LIMIT) entries.delete(entries.keys().next().value as string)
  return value
}

export const clearScopes = () => scopes.clear()

// Uses a fresh entry when available; only memoizes a resolved value, so an error or abort
// leaves the bucket untouched.
export const fromScope = async <T>(scope: string, key: string, fetcher: () => Promise<T>): Promise<T> => {
  const hit = readScope(scope, key)
  if (hit) return hit.value as T
  return writeScope(scope, key, await fetcher()) as T
}

// Trailing edge: the reader pays for the option they stop on, not every option they pass through.
export const debounce = (fn: () => void, ms = 140) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return () => {
    clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}
