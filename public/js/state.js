// Mutable UI state, owned here so api.js/layout.js/render.js stay stateless. `state` itself
// is a live-mutated object (consumers write state.source/state.domain directly); everything
// else goes through a getter/setter pair so the module that owns the value is the only one
// that can reassign it — ES module bindings can't be reassigned from the importing side.

export const state = { source: 'all', domain: 'all' }

/** @type {Map<string, import('./format.js').Layout>} */
export const layoutCache = new Map()

/** @type {string | null} */
let selected = null
export const getSelected = () => selected
/** @param {string | null} id */
export const setSelected = (id) => {
  selected = id
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
