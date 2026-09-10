// Page-wide, DOM-free state: the scope memo (shared by every figure) plus the two generic
// helpers both figures need. Everything that is genuinely per-figure (the source filter, the
// focused outlet, zoom, the layout cache, the mask, request/abort bookkeeping) lives inside
// that figure's own module now, the same way src/ui/app.ts already kept people/graph/nodes
// as local module state rather than here.

// Bounded, short-lived memo of successful API responses (issue #43). One bucket per scope
// (graph, sources, docs, testimony) because each depends on a different subset of the
// controls: the outlet list ignores sort and term limit entirely, so a sort change must not
// evict it. Only resolved values are written, so an error or an abort never becomes a cache
// hit, and the TTL is deliberately shorter than a reader's attention span: this coalesces one
// burst of filter fiddling, it is not an offline store. Shared across figures on purpose: every
// key already embeds the person id and the full querystring, so two figures on two different
// people never collide on the same bucket entry.
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

// Returns a one-element box on a hit and null on a miss, so a cached `undefined` or `null`
// response is still distinguishable from "nothing cached".
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
  // Insertion order is eviction order: the oldest write goes first, so a long session cannot
  // grow the memo without bound.
  while (entries.size > SCOPE_LIMIT) entries.delete(entries.keys().next().value as string)
  return value
}

export const clearScopes = () => scopes.clear()

// Reuses a fresh entry instead of fetching, and only memoizes a value the fetch actually
// resolved: a rejection (network error, or the browser aborting the request) leaves the
// bucket untouched, so the next attempt is a real attempt. An abort here says the browser
// stopped listening, never that the server stopped running the SQL.
export const fromScope = async <T>(scope: string, key: string, fetcher: () => Promise<T>): Promise<T> => {
  const hit = readScope(scope, key)
  if (hit) return hit.value as T
  return writeScope(scope, key, await fetcher()) as T
}

// Coalesces a burst of control changes into one load. The trailing edge is the one that
// matters: a reader dragging through the period options should pay for the option they stop
// on, not for every option they pass through.
export const debounce = (fn: () => void, ms = 140) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return () => {
    clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}
