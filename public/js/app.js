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
} from './render.js'
import {
  cancelDocs,
  currentDocsId,
  currentRequestId,
  getCandidateController,
  getController,
  getSelected,
  getZoom,
  layoutCache,
  nextRequestId,
  setCandidateController,
  setController,
  setDocsController,
  setSelected,
  setZoomLevel,
  state,
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
// term means "documents about the person", which is `term=''` plus `kind=all`.
/**
 * @param {URLSearchParams} base
 * @param {Term | null} n
 */
export const docsQuery = (base, n) => {
  const q = new URLSearchParams(base)
  q.set('term', n ? n.term : '')
  q.set('kind', n ? n.kind : 'all')
  q.set('limit', '5')
  return q
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
/** @type {import('./format.js').Measure | null} */
let measure = null

const measured = () => (measure ??= createCanvasMeasure())

const controlValues = () => ({ days: $('days').value, sort: $('sort').value, limit: $('limit').value, source: state.source, domain: state.domain })
const graphQuery = () => api.params(controlValues())
const daysLabel = () => $('days').selectedOptions[0].textContent.toLowerCase()

const refreshSegActive = () => {
  const buttons = /** @type {NodeListOf<HTMLElement>} */ ($('segSource').querySelectorAll('.segbtn'))
  buttons.forEach((btn) => btn.classList.toggle('active', btn.dataset.value === state.source))
}

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
  paintSelection({ nodes, links, selected: getSelected(), search: $('search').value, layout: currentLayout, mode, sort: $('sort').value, onChoose: choose })

const paintCurrentInspector = () =>
  inspect({ graph, nodes, links, selected: getSelected(), sort: $('sort').value, daysLabel: daysLabel(), onChoose: choose, onShowDocs: loadDocs })

const drawCurrentMap = () => {
  const current = /** @type {Graph} */ (graph)
  currentLayout = getLayout()
  drawMap({ layout: currentLayout, personName: current.person.name, about: current.stats?.about, mode, sort: $('sort').value, onChoose: choose })
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
  paintDocsLoading()
  if ($('showDocs')) $('showDocs').disabled = true
  try {
    const data = await api.loadDocs($('person').value, docsQuery(graphQuery(), n), docsController.signal)
    if (id !== currentDocsId()) return
    paintDocs(data)
  } catch (e) {
    if (id === currentDocsId() && !aborted(e)) paintDocsError(() => loadDocs(n))
  } finally {
    if (id === currentDocsId() && $('showDocs')) $('showDocs').disabled = false
  }
}

/** @param {number} id @param {AbortSignal} signal */
const loadSourcesFlow = async (id, signal) => {
  try {
    const rows = await api.loadSources($('person').value, api.sourcesParams(controlValues()), signal)
    if (id !== currentRequestId()) return
    paintOutlets({
      rows,
      domain: state.domain,
      onPick: (d) => {
        state.domain = d
        updateHeader()
        load()
      },
    })
  } catch (e) {
    if (id === currentRequestId() && !aborted(e)) paintOutletsError()
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
  $('viewport').hidden = mode !== 'map'
  $('columns').hidden = mode !== 'columns'
  if (nodes.length) {
    if (!currentLayout || mode === 'map') drawCurrentMap()
    $('overflow').hidden = mode !== 'map' || !currentLayout?.overflow?.length
    paintColumns({ nodes, links, selected: getSelected(), search: $('search').value, sort: $('sort').value, mode, onChoose: choose })
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

const resetGraph = () => {
  layoutCache.clear()
  currentLayout = null
  setSelected(null)
  setZoomLevel(1)
  $('search').value = ''
  $('searchNote').textContent = ''
  $('selectionNote').textContent = ''
  $('overflow').hidden = true
  $('columns').innerHTML = ''
}

const updateHeader = () => {
  const person = people.find((p) => p.id === $('person').value)
  const source = sourceLabels[state.source] || state.source
  const pick = /** @type {HTMLElement} */ (document.querySelector('.person-pick'))
  pick.textContent = person ? `Pessoa: ${person.name}` : ''
  $('stats').hidden = !graph
  $('stats').textContent = graph ? `${fmt(graph.stats?.about)} docs · ${source}${domainSuffix(state.domain)}` : ''
  $('stamp').textContent = `Base local · ${source} · mínimo de 2 documentos` + domainSuffix(state.domain)
}

// The controller for the request in flight; `load` replaces it before every fetch, so this
// is never read before it is set.
const signal = () => /** @type {AbortController} */ (getController()).signal

const load = async () => {
  const id = nextRequestId()
  getController()?.abort()
  setController(new AbortController())
  cancelDocs()
  resetGraph()
  busy = true
  graph = null
  nodes = []
  links = []
  $('status').classList.remove('error')
  $('status').textContent = 'Carregando a base local…'
  $('viewport').hidden = false
  $('columns').hidden = true
  $('viewport').setAttribute('aria-busy', 'true')
  $('viewport').innerHTML = '<div class="empty">Carregando o campo de palavras…</div>'
  $('inspector').textContent = 'Aguardando dados.'
  $('legend').textContent = ''
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
    const data = await api.loadGraph($('person').value, graphQuery(), signal())
    if (id !== currentRequestId()) return
    graph = data
    busy = false
    $('status').textContent = `Base local · ${data.person.name} · ${fmt(data.stats.about)} documentos sobre a pessoa · ${daysLabel()}${domainSuffix(state.domain)}`
    updateHeader()
    render()
  } catch (e) {
    if (id !== currentRequestId() || aborted(e)) return
    busy = false
    $('status').classList.add('error')
    $('status').textContent = 'Não foi possível carregar dados reais.'
    $('viewport').innerHTML =
      '<div class="empty">Falha de rede ou base indisponível.<br>Nenhum grafo fictício será exibido.<br><br><button class="quiet-button" id="retry">Tentar novamente</button></div>'
    $('retry').addEventListener('click', load)
    $('inspector').textContent = 'Use tentar novamente quando a API estiver disponível.'
  } finally {
    if (id === currentRequestId()) $('viewport').setAttribute('aria-busy', 'false')
  }
}

const handlers = createHandlers({
  paintCurrentSelection,
  choose,
  load,
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
    refreshSegActive()
  },
})

export const boot = () => {
  $('segSource').innerHTML = SOURCE_SEGMENTS.map(([value, text]) => `<button class="segbtn" data-value="${value}">${text}</button>`).join('')
  const segButtons = /** @type {NodeListOf<HTMLElement>} */ ($('segSource').querySelectorAll('.segbtn'))
  segButtons.forEach((btn) => btn.addEventListener('click', handlers.source(String(btn.dataset.value))))
  refreshSegActive()
  $('modeMap').addEventListener('click', handlers.modeMap)
  $('modeColumns').addEventListener('click', handlers.modeColumns)
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
