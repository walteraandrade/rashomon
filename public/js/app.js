// The page's own wiring: reads the controls, drives api.js, hands data to render.js and
// binds every DOM event. public/design-5.html carries markup only and loads this file as its
// single <script type="module">, so nothing here hides inside the HTML where no test can
// reach it. Importing this module is side-effect free outside a browser: `boot()` runs only
// when a `document` exists, which is what lets node:test import the pieces below.

import * as api from './api.js'
import { domainSuffix, fmt, label, SOURCE_SEGMENTS, sourceLabels } from './format.js'
import { centerLabel, pack } from './layout.js'
import {
  createCanvasMeasure,
  drawMap,
  inspect,
  paintCandidates,
  paintCandidatesError,
  paintCandidatesLoading,
  paintColumns,
  paintDocs,
  paintDocsError,
  paintDocsLoading,
  paintOutlets,
  paintOutletsError,
  paintSelection,
  paintStrip,
  paintTestimony,
  paintTestimonyError,
  paintTestimonyLoading,
} from './render.js'
import {
  cancelDocs,
  currentDocsId,
  currentRequestId,
  getCandidateController,
  getController,
  getMask,
  getSelected,
  getZoom,
  layoutCache,
  nextRequestId,
  readScope,
  setCandidateController,
  setController,
  setDocsController,
  setMask,
  setSelected,
  setZoomLevel,
  state,
  writeScope,
} from './state.js'

/** @typedef {import('./format.js').Graph} Graph */
/** @typedef {import('./format.js').Layout} Layout */
/** @typedef {import('./format.js').Link} Link */
/** @typedef {import('./format.js').Term} Term */
/** @typedef {{ id: string, name: string }} Person */

// Elements this page owns by id. The markup in design-5.html guarantees each one exists, and
// the values read off them (select.value, button.disabled) are per-element, so this is typed
// loosely on purpose rather than casting at all ~100 call sites.
/** @type {(id: string) => any} */
const $ = (id) => document.getElementById(id)

// A caught value is `unknown`; the flows below only ever ask whether the browser aborted the
// request, so this is the one place that inspects it.
/** @param {unknown} e */
const aborted = (e) => e instanceof Error && e.name === 'AbortError'


// The event table. Every DOM listener the page installs resolves to exactly one entry here,
// and each entry may only call the actions it is handed, so the mapping is inspectable
// without a document. `search` is the load-bearing one: highlighting must repaint the
// selection and nothing else, since rebuilding the inspector would wipe the documents the
// reader already loaded (issue #28).
/**
 * @param {{
 *   paintCurrentSelection?: () => void,
 *   choose?: (id: string | null) => void,
 *   load?: () => void,
 *   loadCandidates?: () => void,
 *   setMode?: (mode: string) => void,
 *   setZoom?: (zoom: number) => void,
 *   getZoomLevel?: () => number,
 *   clearSearch?: () => void,
 *   canClear?: () => boolean,
 *   resetDomain?: () => void,
 *   updateHeader?: () => void,
 *   setSource?: (source: string) => void,
 *   toggleMask?: () => void,
 * }} actions every action is optional so a test can inject only the ones a criterion is about
 */
export const createHandlers = ({
  paintCurrentSelection = () => {},
  choose = () => {},
  load = () => {},
  loadCandidates = () => {},
  setMode = () => {},
  setZoom = () => {},
  getZoomLevel = () => 1,
  clearSearch = () => {},
  canClear = () => true,
  resetDomain = () => {},
  updateHeader = () => {},
  setSource = () => {},
  toggleMask = () => {},
}) => ({
  search: () => {
    paintCurrentSelection()
  },
  clear: () => {
    if (!canClear()) return
    clearSearch()
    choose(null)
  },
  /** @param {{ key: string }} e */
  keydown: (e) => {
    if (e.key !== 'Escape' || !canClear()) return
    clearSearch()
    choose(null)
  },
  modeMap: () => setMode('map'),
  modeColumns: () => setMode('columns'),
  // Paint only: the per-term testimony always travels with the graph (api.js's testimony=1).
  mask: () => toggleMask(),
  // One handler per control id, so the person control is the only one that drops the outlet
  // filter and the period control is the only one that refetches the candidate queue.
  /** @param {string} id */
  control: (id) => () => {
    if (id === 'person') resetDomain()
    if (id === 'days') loadCandidates()
    updateHeader()
    load()
  },
  /** @param {string} value */
  source: (value) => () => {
    setSource(value)
    load()
    updateHeader()
  },
  zoomIn: () => setZoom(getZoomLevel() + 0.25),
  zoomOut: () => setZoom(getZoomLevel() - 0.25),
  zoomReset: () => setZoom(1),
})

// The layout cache key: the same person, sort, term limit and term list must reuse the same
// packing, and any change to them must not.
/**
 * @param {Person | undefined} person
 * @param {Term[]} terms
 * @param {string} sort
 * @param {string} limit
 */
export const layoutKey = (person, terms, sort, limit) =>
  JSON.stringify(person ? [person.id, person.name, sort, limit, terms.map((n) => [n.id, n.term, n.kind, n.count, n.pmi])] : [])

// The docs panel reuses the graph querystring, narrowed to one term and five rows. A null
// term means "documents about the person", which is `term=''` plus `kind=all`. `sort` and
// `min` are dropped (issue #43): src/query.ts's parseDocsQuery reads neither, so leaving
// them in made the same five rows look like a new query on every sort change.
/**
 * @param {URLSearchParams} base
 * @param {Term | null} n
 */
export const docsQuery = (base, n) => {
  const q = new URLSearchParams(base)
  q.delete('sort')
  q.delete('min')
  q.delete('testimony')
  q.set('term', n ? n.term : '')
  q.set('kind', n ? n.kind : 'all')
  q.set('limit', '5')
  return q
}

// Issue #43: one cache key per scope, built from the filters that scope's route actually
// reads, so a change to a control the route ignores cannot evict it. The keys are the
// querystrings themselves, which is what makes them honest: whatever ends up in the URL ends
// up in the key, and a parameter added to a route later cannot silently share a stale entry.
/**
 * @param {string} personId
 * @param {URLSearchParams} graphParams the full params() querystring
 * @param {Term | null} [term] the docs panel's term, null for the person's own documents
 */
export const scopeKeys = (personId, graphParams, term = null) => ({
  graph: personId + '?' + graphParams,
  sources: personId + '?' + api.narrowToSources(graphParams),
  docs: personId + '?' + docsQuery(graphParams, term),
  testimony: personId + '?' + api.narrowToTestimony(graphParams),
})

// Reuses a fresh entry instead of fetching, and only memoizes a value the fetch actually
// resolved: a rejection (network error, or the browser aborting the request) leaves the
// bucket untouched, so the next attempt is a real attempt. An abort here says the browser
// stopped listening, never that the server stopped running the SQL.
/**
 * @template T
 * @param {string} scope
 * @param {string} key
 * @param {() => Promise<T>} fetcher
 * @returns {Promise<T>}
 */
export const fromScope = async (scope, key, fetcher) => {
  const hit = readScope(scope, key)
  if (hit) return /** @type {T} */ (hit.value)
  return /** @type {T} */ (writeScope(scope, key, await fetcher()))
}

// Coalesces a burst of control changes into one load. The trailing edge is the one that
// matters: a reader dragging through the period options should pay for the option they stop
// on, not for every option they pass through.
/**
 * @param {() => void} fn
 * @param {number} [ms]
 */
export const debounce = (fn, ms = 140) => {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  return () => {
    clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}

/** @type {Person[]} */
let people = []
/** @type {Graph | null} */
let graph = null
/** @type {Term[]} */
let nodes = []
/** @type {Link[]} */
let links = []
let busy = false
let mode = 'map'
/** @type {Layout | null} */
let currentLayout = null
let lastMapWidth = 0
let lastStripWidth = 0
/** @type {import('./format.js').Testimony | null} */
let testimony = null
/** @type {import('./format.js').Measure | null} */
let measure = null

const measured = () => (measure ??= createCanvasMeasure())

const controlValues = () => ({ days: $('days').value, sort: $('sort').value, limit: $('limit').value, source: state.source, domain: state.domain })
const graphQuery = () => api.params(controlValues())
const daysLabel = () => $('days').selectedOptions[0].textContent.toLowerCase()

const getLayout = () => {
  const person = /** @type {Graph} */ (graph).person
  const key = layoutKey(person, nodes, $('sort').value, $('limit').value)
  if (!layoutCache.has(key)) layoutCache.set(key, pack(measured(), nodes, centerLabel(measured(), person.name), $('sort').value))
  return /** @type {Layout} */ (layoutCache.get(key))
}

const resizeMap = () => {
  const svg = $('viewport').querySelector('svg')
  if (svg) {
    const width = $('viewport').clientWidth
    svg.style.setProperty('--map-width', Math.max(640, Math.min(900, width - 24)) * getZoom() + 'px')
    if (width !== lastMapWidth) {
      lastMapWidth = width
      $('viewport').scrollLeft = Math.max(0, ($('viewport').scrollWidth - width) / 2)
    }
  }
  // The strip is drawn in pixels, so a width change redraws it from the data in hand.
  const stripWidth = $('strip').clientWidth
  if (testimony && stripWidth && stripWidth !== lastStripWidth) {
    lastStripWidth = stripWidth
    paintStrip({ data: testimony, domain: state.domain, onPick: pickDomain, width: stripWidth })
  }
  $('zoomReset').textContent = Math.round(getZoom() * 100) + '%'
  $('zoomOut').disabled = getZoom() <= 1
  $('zoomIn').disabled = getZoom() >= 2
}

/** @param {number} value */
const setZoom = (value) => {
  const vp = $('viewport')
  const oldWidth = Math.max(1, vp.scrollWidth)
  const center = (vp.scrollLeft + vp.clientWidth / 2) / oldWidth
  setZoomLevel(value)
  resizeMap()
  vp.scrollLeft = center * vp.scrollWidth - vp.clientWidth / 2
}

const paintCurrentSelection = () =>
  paintSelection({ nodes, links, selected: getSelected(), search: $('search').value, layout: currentLayout, mode, sort: $('sort').value, onChoose: choose, mask: getMask(), personTestimony: graph?.stats?.testimony })

const paintCurrentInspector = () =>
  inspect({ graph, nodes, links, selected: getSelected(), sort: $('sort').value, daysLabel: daysLabel(), onChoose: choose, onShowDocs: loadDocs })

const drawCurrentMap = () => {
  const current = /** @type {Graph} */ (graph)
  currentLayout = getLayout()
  drawMap({ layout: currentLayout, personName: current.person.name, about: current.stats?.about, mode, sort: $('sort').value, onChoose: choose, personTestimony: current.stats?.testimony })
  resizeMap()
  paintCurrentSelection()
  $('viewport').scrollLeft = Math.max(0, ($('viewport').scrollWidth - $('viewport').clientWidth) / 2)
}

/** @param {string | null} id */
const choose = (id) => {
  setSelected(id)
  cancelDocs()
  paintCurrentSelection()
  paintCurrentInspector()
  const chosen = nodes.find((n) => n.id === id)
  $('selectionNote').textContent = chosen ? `${label(chosen)} selecionado. Detalhes atualizados.` : 'Seleção limpa.'
}

/** @param {Term | null} n */
const loadDocs = async (n) => {
  const id = cancelDocs()
  const docsController = new AbortController()
  setDocsController(docsController)
  if (!$('docs') || !graph || !$('person').value) return
  const person = $('person').value
  const base = graphQuery()
  const query = docsQuery(base, n)
  const key = scopeKeys(person, base, n).docs
  // A hit paints straight from the memo, so re-entering the unselected inspector after a
  // sort change, a view-mode switch or an outlet re-click shows the same five documents
  // without a second request. A miss still shows the loading copy first.
  const cached = readScope('docs', key)
  if (!cached) paintDocsLoading()
  try {
    const data = await fromScope('docs', key, () => api.loadDocs(person, query, docsController.signal))
    if (id !== currentDocsId()) return
    paintDocs(data)
  } catch (e) {
    if (id === currentDocsId() && !aborted(e)) paintDocsError(() => loadDocs(n))
  }
}

// Picking an outlet only narrows the graph and the documents: the outlet list itself is the
// same list, so it is repainted from the memo with the new active row rather than refetched.
/** @param {string} d */
const pickDomain = (d) => {
  if (d === state.domain) return
  state.domain = d
  updateHeader()
  debouncedLoad()
}

/** @param {number} id @param {AbortSignal} signal */
const loadSourcesFlow = async (id, signal) => {
  const person = $('person').value
  const key = scopeKeys(person, graphQuery()).sources
  try {
    const rows = await fromScope('sources', key, () => api.loadSources(person, api.sourcesParams(controlValues()), signal))
    if (id !== currentRequestId()) return
    paintOutlets({ rows, domain: state.domain, onPick: pickDomain })
  } catch (e) {
    if (id === currentRequestId() && !aborted(e)) paintOutletsError()
  }
}

// Same shape as the outlet list: keyed by what the route reads, so a sort, limit or outlet
// change repaints from the memo (with the new active outlet) instead of refetching. A miss
// blanks the panel first, so one person's numbers never sit under the next person's name.
/** @param {number} id @param {AbortSignal} signal */
const loadTestimonyFlow = async (id, signal) => {
  const person = $('person').value
  const key = scopeKeys(person, graphQuery()).testimony
  if (!readScope('testimony', key)) {
    testimony = null
    paintTestimonyLoading()
  }
  try {
    const data = await fromScope('testimony', key, () => api.loadTestimony(person, api.testimonyParams(controlValues()), signal))
    if (id !== currentRequestId()) return
    testimony = data
    paintTestimony({ data, domain: state.domain, onPick: pickDomain })
    lastStripWidth = $('strip').clientWidth || 0
    paintStrip({ data, domain: state.domain, onPick: pickDomain, width: lastStripWidth || undefined })
  } catch (e) {
    if (id === currentRequestId() && !aborted(e)) {
      testimony = null
      paintTestimonyError()
    }
  }
}

const loadCandidatesFlow = async () => {
  getCandidateController()?.abort()
  const controller = new AbortController()
  setCandidateController(controller)
  paintCandidatesLoading()
  try {
    const data = await api.loadCandidates(api.candidatesQuery({ days: $('days').value }), controller.signal)
    if (!controller.signal.aborted) paintCandidates(data)
  } catch (e) {
    if (!aborted(e)) paintCandidatesError(loadCandidatesFlow)
  }
}

/** @param {AbortSignal} signal */
const loadPeopleFlow = async (signal) => {
  people = await api.loadPeople(signal)
  $('person').innerHTML = ''
  people.forEach((/** @type {Person} */ p) => $('person').add(new Option(p.name, p.id)))
  updateHeader()
  return people
}

const render = () => {
  if (busy || !graph) return
  const current = graph
  nodes = current.nodes.slice(0, Number($('limit').value))
  const ids = new Set(nodes.map((n) => n.id))
  links = current.links.filter((l) => ids.has(l.source) && ids.has(l.target))
  const previouslySelected = getSelected()
  if (previouslySelected === null || !ids.has(previouslySelected)) setSelected(null)
  $('modeMap').setAttribute('aria-pressed', String(mode === 'map'))
  $('modeColumns').setAttribute('aria-pressed', String(mode === 'columns'))
  $('mask').setAttribute('aria-pressed', String(getMask()))
  $('viewport').hidden = mode !== 'map'
  $('columns').hidden = mode !== 'columns'
  if (nodes.length) {
    if (!currentLayout || mode === 'map') drawCurrentMap()
    $('overflow').hidden = mode !== 'map' || !currentLayout?.overflow?.length
    paintColumns({ nodes, links, selected: getSelected(), search: $('search').value, sort: $('sort').value, mode, onChoose: choose, personTestimony: current.stats?.testimony })
  } else {
    $('viewport').innerHTML = '<div class="empty">Nenhum termo neste recorte.<br>Experimente outra pessoa ou um período maior.</div>'
    $('columns').innerHTML = '<div class="empty">Nenhum termo neste recorte.</div>'
    $('legend').textContent = 'Sem dados para desenhar.'
    $('overflow').hidden = true
    currentLayout = null
  }
  paintCurrentInspector()
}

/** @param {string} next */
const setMode = (next) => {
  mode = next
  cancelDocs()
  render()
}

// Resets the reader's state, not the painted surfaces: the old map, columns and overflow list
// stay on screen until render() replaces them, so nothing under them moves while a load is in
// flight (see load()).
const resetGraph = () => {
  layoutCache.clear()
  currentLayout = null
  setSelected(null)
  setZoomLevel(1)
  $('search').value = ''
  $('searchNote').textContent = ''
  $('selectionNote').textContent = ''
}

const updateHeader = () => {
  const source = sourceLabels[state.source] || state.source
  $('stats').hidden = !graph
  $('stats').textContent = graph ? `${fmt(graph.stats?.about)} docs · ${source}${domainSuffix(state.domain)}` : ''
}

// The controller for the request in flight; `load` replaces it before every fetch, so this
// is never read before it is set.
const signal = () => /** @type {AbortController} */ (getController()).signal

// A reload keeps the previous map, columns, legend and inspector on screen, dimmed by the
// `is-loading` class, and swaps them in one go when the data lands. Blanking them first made
// the map column collapse from its drawn height to the empty-state minimum for the length of
// the request, which threw the testimony strip and everything under it hundreds of pixels up
// and back down on every outlet click. Only the very first load, with nothing to keep, shows
// the loading copy in place of a map.
const load = async () => {
  const id = nextRequestId()
  getController()?.abort()
  setController(new AbortController())
  cancelDocs()
  resetGraph()
  const first = !graph
  busy = true
  graph = null
  nodes = []
  links = []
  $('status').classList.remove('error')
  $('status').textContent = 'Carregando a base local…'
  $('viewport').setAttribute('aria-busy', 'true')
  $('workspace').classList.add('is-loading')
  if (first) {
    $('viewport').innerHTML = '<div class="empty">Carregando o campo de palavras…</div>'
    $('inspector').textContent = 'Aguardando dados.'
  }
  try {
    if (!people.length) {
      const loaded = await loadPeopleFlow(signal())
      if (id !== currentRequestId()) return
      if (!loaded.length) {
        busy = false
        $('status').textContent = 'Nenhuma pessoa cadastrada.'
        $('viewport').innerHTML = '<div class="empty">A lista de pessoas está vazia.<br><button class="quiet-button" id="retry">Tentar novamente</button></div>'
        $('retry').addEventListener('click', load)
        $('inspector').textContent = 'Cadastre pessoas em seed.json e rode o índice.'
        return
      }
    }
    loadSourcesFlow(id, signal())
    loadTestimonyFlow(id, signal())
    const person = $('person').value
    const query = graphQuery()
    const data = await fromScope('graph', scopeKeys(person, query).graph, () => api.loadGraph(person, query, signal()))
    if (id !== currentRequestId()) return
    graph = data
    busy = false
    $('status').textContent = `${fmt(data.stats.about)} documentos sobre ${data.person.name} neste recorte${domainSuffix(state.domain)}.`
    updateHeader()
    render()
  } catch (e) {
    if (id !== currentRequestId() || aborted(e)) return
    busy = false
    $('status').classList.add('error')
    $('status').textContent = 'Não foi possível carregar dados reais.'
    $('viewport').hidden = false
    $('columns').hidden = true
    $('overflow').hidden = true
    $('legend').textContent = ''
    $('viewport').innerHTML =
      '<div class="empty">Falha de rede ou base indisponível.<br>Nenhum grafo fictício será exibido.<br><br><button class="quiet-button" id="retry">Tentar novamente</button></div>'
    $('retry').addEventListener('click', load)
    $('inspector').textContent = 'Use tentar novamente quando a API estiver disponível.'
  } finally {
    if (id === currentRequestId()) {
      $('viewport').setAttribute('aria-busy', 'false')
      $('workspace').classList.remove('is-loading')
    }
  }
}

// The controls debounce; boot() and the retry button do not. createHandlers keeps calling
// whatever `load` it is handed synchronously, so its own contract (and the tests written
// against it) is untouched — the coalescing lives here, at the wiring site.
const debouncedLoad = debounce(load)

const handlers = createHandlers({
  paintCurrentSelection,
  choose,
  load: debouncedLoad,
  loadCandidates: loadCandidatesFlow,
  setMode,
  setZoom,
  getZoomLevel: getZoom,
  clearSearch: () => {
    $('search').value = ''
  },
  canClear: () => !busy && !!graph,
  resetDomain: () => {
    state.domain = 'all'
  },
  updateHeader,
  setSource: (value) => {
    state.source = value
    $('source').value = value
  },
  toggleMask: () => {
    setMask(!getMask())
    $('mask').setAttribute('aria-pressed', String(getMask()))
    if (graph && !busy) paintCurrentSelection()
  },
})

export const boot = () => {
  $('source').innerHTML = SOURCE_SEGMENTS.map(([value, text]) => `<option value="${value}">${sourceLabels[value] ?? text}</option>`).join('')
  $('source').value = state.source
  $('source').addEventListener('change', () => handlers.source(String($('source').value))())
  $('modeMap').addEventListener('click', handlers.modeMap)
  $('modeColumns').addEventListener('click', handlers.modeColumns)
  $('mask').addEventListener('click', handlers.mask)
  for (const id of ['person', 'days', 'sort', 'limit']) $(id).addEventListener('change', handlers.control(id))
  $('search').addEventListener('input', handlers.search)
  $('clear').addEventListener('click', handlers.clear)
  $('zoomIn').addEventListener('click', handlers.zoomIn)
  $('zoomOut').addEventListener('click', handlers.zoomOut)
  $('zoomReset').addEventListener('click', handlers.zoomReset)
  document.addEventListener('keydown', handlers.keydown)
  new ResizeObserver(resizeMap).observe($('viewport'))
  document.fonts?.ready?.then(() => {
    layoutCache.clear()
    if (graph && !busy) render()
  })
  loadCandidatesFlow()
  load()
}

if (typeof document !== 'undefined') boot()
