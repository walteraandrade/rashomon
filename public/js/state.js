// Mutable UI state, owned here so api.js/layout.js/render.js stay stateless. `state` itself
// is a live-mutated object (consumers write state.source/state.domain directly); everything
// else goes through a getter/setter pair so the module that owns the value is the only one
// that can reassign it — ES module bindings can't be reassigned from the importing side.

export const state = { source: 'all', domain: 'all' }

export const layoutCache = new Map()

let selected = null
export const getSelected = () => selected
export const setSelected = (id) => {
  selected = id
}

let zoom = 1
export const getZoom = () => zoom
export const setZoomLevel = (z) => {
  zoom = Math.max(1, Math.min(2, z))
  return zoom
}

let requestId = 0
export const nextRequestId = () => ++requestId
export const currentRequestId = () => requestId

let controller = null
export const setController = (c) => {
  controller = c
}
export const getController = () => controller

let docsId = 0
let docsController = null
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
