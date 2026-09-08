import { int } from './query.js'
import type { Person } from './types.js'

// In-process only, by design: nothing is shared between processes and nothing survives a
// restart, so "invalidation on restart" is the absence of state rather than a mechanism.
export type CacheStats = {
  entries: number
  bytes: number
  hits: number
  misses: number
  coalesced: number
  expired: number
  evictions: number
}

export type Cache<T> = {
  take: (key: string, load: () => Promise<T>) => Promise<T>
  clear: () => void
  stats: () => CacheStats
}

export type CacheOptions<T> = {
  ttlMs: number
  maxEntries: number
  maxBytes: number
  // Bytes charged to the memory budget once an entry settles; 0 keeps the cache bounded by
  // entry count alone (the person cache, whose rows are a handful of short strings).
  weigh?: (value: T) => number
  enabled?: boolean
  now?: () => number
}

// `promise` is the single in-flight execution every coalesced caller awaits. `settled` gates
// expiry: a pending entry is never treated as stale, otherwise a load slower than the TTL
// would start a second execution while the first is still running.
type Entry<T> = { expiresAt: number; bytes: number; settled: boolean; promise: Promise<T> }

export const createCache = <T>({ ttlMs, maxEntries, maxBytes, weigh, enabled = true, now = Date.now }: CacheOptions<T>): Cache<T> => {
  // Insertion order is the eviction order; a hit re-inserts its key, which makes it LRU.
  const store = new Map<string, Entry<T>>()
  let bytes = 0
  let hits = 0
  let misses = 0
  let coalesced = 0
  let expired = 0
  let evictions = 0

  const drop = (key: string, entry: Entry<T>) => {
    store.delete(key)
    bytes -= entry.bytes
  }

  const evictOldest = () => {
    for (const [key, entry] of store) {
      drop(key, entry)
      evictions += 1
      return
    }
  }

  // Both bounds are enforced after every insert and after every settle, so a single response
  // larger than the whole budget ends up evicted too instead of pinning the cache over it.
  const enforce = () => {
    while (store.size > maxEntries) evictOldest()
    while (bytes > maxBytes && store.size > 0) evictOldest()
  }

  const take = (key: string, load: () => Promise<T>): Promise<T> => {
    if (!enabled) return load()
    const existing = store.get(key)
    if (existing) {
      if (!existing.settled) {
        coalesced += 1
        return existing.promise
      }
      if (existing.expiresAt > now()) {
        hits += 1
        store.delete(key)
        store.set(key, existing)
        return existing.promise
      }
      expired += 1
      drop(key, existing)
    }
    misses += 1
    const entry: Entry<T> = { expiresAt: now() + ttlMs, bytes: 0, settled: false, promise: undefined as unknown as Promise<T> }
    // The identity check keeps a slow load from resurrecting an entry that clear() or an
    // eviction already removed, and from deleting the entry a later miss put in its place.
    entry.promise = load().then(
      (value) => {
        if (store.get(key) === entry) {
          entry.settled = true
          entry.bytes = weigh ? weigh(value) : 0
          bytes += entry.bytes
          enforce()
        }
        return value
      },
      (error) => {
        // A rejected load is never retained: the next caller re-runs it.
        if (store.get(key) === entry) drop(key, entry)
        throw error
      },
    )
    store.set(key, entry)
    enforce()
    return entry.promise
  }

  const clear = () => {
    store.clear()
    bytes = 0
  }

  const stats = (): CacheStats => ({ entries: store.size, bytes, hits, misses, coalesced, expired, evictions })

  return { take, clear, stats }
}

// Every knob has a default, a floor and a ceiling, read once at import, through the same
// clamp the query parsers use.
export const cacheEnabled = process.env.CACHE !== '0' && process.env.CACHE !== 'false'
export const readTtlMs = int(process.env.CACHE_TTL_MS, 30_000, 0, 3_600_000)
export const personTtlMs = int(process.env.CACHE_PERSON_TTL_MS, 300_000, 0, 3_600_000)
export const maxReadEntries = int(process.env.CACHE_MAX_ENTRIES, 500, 1, 100_000)
export const maxReadBytes = int(process.env.CACHE_MAX_BYTES, 32 * 1024 * 1024, 64 * 1024, 512 * 1024 * 1024)
export const maxPersonEntries = int(process.env.CACHE_MAX_PERSONS, 200, 1, 10_000)

// Serialized bodies, not objects: the byte budget is then the real thing being bounded, and
// a hit skips re-serializing a response the route already turned into JSON once.
export const reads = createCache<string>({
  ttlMs: readTtlMs,
  maxEntries: maxReadEntries,
  maxBytes: maxReadBytes,
  weigh: (body) => Buffer.byteLength(body),
  enabled: cacheEnabled,
})

// null is cached too: a request for an unknown id is a successful read of "no such person",
// and caching it is what keeps a scan of bogus ids from reaching the database on every hit.
export const people = createCache<Person | null>({
  ttlMs: personTtlMs,
  maxEntries: maxPersonEntries,
  maxBytes: Number.MAX_SAFE_INTEGER,
  enabled: cacheEnabled,
})

// The one invalidation point. Called by tests between fixtures and by src/store.ts after an
// in-process write; the whole cache goes, because a single new doc can move any window,
// any PMI denominator and any person's terms at once.
export const resetCaches = () => {
  reads.clear()
  people.clear()
}
