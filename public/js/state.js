// Mutable UI state, owned here so api.js/layout.js/render.js stay stateless. `state` itself
// is a live-mutated object (consumers write state.source directly); everything
// else goes through a getter/setter pair so the module that owns the value is the only one
// that can reassign it — ES module bindings can't be reassigned from the importing side.

export const state = { source: 'all' }

/** @type {Map<string, import('./format.js').Layout>} */
export const layoutCache = new Map()

/** @type {string | null} */
let selected = null
export const getSelected = () => selected
/** @param {string | null} id */
export const setSelected = (id) => {
  selected = id
}

// The colour mask over the map's words (testimony per term against the person's mean). A
// paint-only flag: the data it reads always travels with the graph. On by default: the colour
// is the one reading the atlas adds over a word cloud.
let mask = true
export const getMask = () => mask
/** @param {boolean} on */
export const setMask = (on) => {
  mask = on
}

let zoom = 1
export const getZoom = () => zoom
/** @param {number} z */
export const setZoomLevel = (z) => {
  zoom = Math.max(1, Math.min(2, z))
  return zoom
}

let requestId = 0
export const nextRequestId = () => ++requestId
export const currentRequestId = () => requestId

/** @type {AbortController | null} */
let controller = null
/** @param {AbortController | null} c */
export const setController = (c) => {
  controller = c
}
export const getController = () => controller

let docsId = 0
/** @type {AbortController | null} */
let docsController = null
/** @param {AbortController | null} c */
export const setDocsController = (c) => {
  docsController = c
}
// Bumps docsId and aborts any in-flight docs fetch, so a stale response can never overwrite
// a newer one: every loadDocs caller checks its own id against currentDocsId() before painting.
export const cancelDocs = () => {
  ++docsId
  docsController?.abort()
  return docsId
}
export const currentDocsId = () => docsId

// The candidate queue reloads whenever the period changes; one controller so a slower earlier
// request can never repaint the panel over a newer one.
/** @type {AbortController | null} */
let candidateController = null
/** @param {AbortController | null} c */
export const setCandidateController = (c) => {
  candidateController = c
}
export const getCandidateController = () => candidateController

// Bounded, short-lived memo of successful API responses (issue #43). One bucket per scope
// (graph, sources, docs) because the three depend on different subsets of the controls: the
// outlet list ignores sort and term limit entirely, so a sort change must not evict it. Only
// resolved values are written, so an error or an abort never becomes a cache hit, and the TTL
// is deliberately shorter than a reader's attention span: this coalesces one burst of
// filter fiddling, it is not an offline store.
export const SCOPE_TTL_MS = 20_000
export const SCOPE_LIMIT = 8

/** @type {Map<string, Map<string, { at: number, value: unknown }>>} */
const scopes = new Map()

/** @param {string} scope */
const bucket = (scope) => {
  const found = scopes.get(scope)
  if (found) return found
  /** @type {Map<string, { at: number, value: unknown }>} */
  const fresh = new Map()
  scopes.set(scope, fresh)
  return fresh
}

// Returns a one-element box on a hit and null on a miss, so a cached `undefined` or `null`
// response is still distinguishable from "nothing cached".
/** @param {string} scope @param {string} key @param {number} [now] */
export const readScope = (scope, key, now = Date.now()) => {
  const entry = bucket(scope).get(key)
  if (!entry) return null
  if (now - entry.at > SCOPE_TTL_MS) {
    bucket(scope).delete(key)
    return null
  }
  return { value: entry.value }
}

/** @param {string} scope @param {string} key @param {unknown} value @param {number} [now] */
export const writeScope = (scope, key, value, now = Date.now()) => {
  const entries = bucket(scope)
  entries.delete(key)
  entries.set(key, { at: now, value })
  // Insertion order is eviction order: the oldest write goes first, so a long session cannot
  // grow the memo without bound.
  while (entries.size > SCOPE_LIMIT) entries.delete(/** @type {string} */ (entries.keys().next().value))
  return value
}

export const clearScopes = () => scopes.clear()
