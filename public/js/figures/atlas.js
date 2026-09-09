// Figure 1, end to end: the sentence (person, days, source, sort, limit), search, pick/
// background, Escape, the map/columns mode toggle, the mask toggle, zoom, the map/columns/
// inspector painters, the documents modal (its markup sits outside #workspace, but only this
// figure ever opens it) and this figure's own stats badge. Importing this module is side-effect
// free outside a browser: mount() runs only once app.js hands it a root element and the
// fetched person list, which is what lets node:test import the pieces below with no document.

import * as api from '../api.js'
import { fmt, label, SOURCE_SEGMENTS, sourceLabels } from '../format.js'
import { centerLabel, pack } from '../layout.js'
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
  paintDocsTitle,
  paintSelection,
} from '../render.js'
import { debounce, fromScope, readScope } from '../state.js'

/** @typedef {import('../format.js').Graph} Graph */
/** @typedef {import('../format.js').Layout} Layout */
/** @typedef {import('../format.js').Link} Link */
/** @typedef {import('../format.js').Term} Term */
/** @typedef {{ id: string, name: string }} Person */
/** @typedef {{ person?: string, days?: string, source?: string, sort?: string, limit?: string }} Seed */
// Whatever GET /api/people rejected with, or null when it answered. Distinct from an empty
// `people` array: an outage must never paint as "no one is registered yet" (issue #92).
/** @typedef {unknown} PeopleError */

// Elements this figure owns by id. The markup in design-5.html guarantees each one exists
// (the sentence and the toolbar live inside #workspace; #docsDialog sits next to it), and the
// values read off them (select.value, button.disabled) are per-element, so this is typed
// loosely on purpose rather than casting at all ~100 call sites.
/** @type {(id: string) => any} */
const $ = (id) => document.getElementById(id)

// A caught value is `unknown`; the flows below only ever ask whether the browser aborted the
// request, so this is the one place that inspects it.
/** @param {unknown} e */
const aborted = (e) => e instanceof Error && e.name === 'AbortError'

// The event table. Every DOM listener this figure installs resolves to exactly one entry
// here, and each entry may only call the actions it is handed, so the mapping is inspectable
// without a document. `search` is the load-bearing one: highlighting must repaint the
// selection and nothing else, since rebuilding the inspector would wipe the documents the
// reader already loaded (issue #28). There is no `resetOutlet` action any more: the outlet in
// focus belongs to figure 2 now, and only figure 2's own controls release it (issue #92).
/**
 * @param {{
 *   paintCurrentSelection?: () => void,
 *   choose?: (id: string | null) => void,
 *   getSelected?: () => string | null,
 *   load?: () => void,
 *   loadCandidates?: () => void,
 *   setMode?: (mode: string) => void,
 *   setZoom?: (zoom: number) => void,
 *   getZoomLevel?: () => number,
 *   clearSearch?: () => void,
 *   canClear?: () => boolean,
 *   updateHeader?: () => void,
 *   setSource?: (source: string) => void,
 *   toggleMask?: () => void,
 *   closeDocs?: () => void,
 *   docsOpen?: () => boolean,
 * }} actions every action is optional so a test can inject only the ones a criterion is about
 */
export const createHandlers = ({
  paintCurrentSelection = () => {},
  choose = () => {},
  getSelected = () => null,
  load = () => {},
  loadCandidates = () => {},
  setMode = () => {},
  setZoom = () => {},
  getZoomLevel = () => 1,
  clearSearch = () => {},
  canClear = () => true,
  updateHeader = () => {},
  setSource = () => {},
  toggleMask = () => {},
  closeDocs = () => {},
  docsOpen = () => false,
}) => ({
  search: () => {
    paintCurrentSelection()
  },
  clear: () => {
    if (!canClear()) return
    clearSearch()
    choose(null)
  },
  // Selecting is a toggle: clicking the selected term again lets it go. Without it the only
  // way back to the clean map was the clear button, which is off in the toolbar, far from the
  // word the reader is looking at.
  /** @param {string | null} id */
  pick: (id) => {
    choose(id !== null && id === getSelected() ? null : id)
  },
  // A click that lands on nothing selectable is the other way out. The listener sits on the
  // map viewport and the list, so the toolbar and the inspector's own buttons never reach it;
  // inside those two, anything without a data-node/data-col is empty space.
  /** @param {Element | null} target */
  background: (target) => {
    if (!getSelected()) return
    if (target && target.closest('[data-node], [data-col]')) return
    choose(null)
  },
  // Escape closes the documents modal when it is open, and only then clears the selection:
  // the reader who closes the texts of a word must still be looking at that word.
  /** @param {{ key: string }} e */
  keydown: (e) => {
    if (e.key !== 'Escape') return
    if (docsOpen()) {
      closeDocs()
      return
    }
    if (!canClear()) return
    clearSearch()
    choose(null)
  },
  modeMap: () => setMode('map'),
  modeColumns: () => setMode('columns'),
  // Paint only: the per-term testimony always travels with the graph (api.js's testimony=1).
  mask: () => toggleMask(),
  // One handler per control id, so the period control is the only one that refetches the
  // candidate queue.
  /** @param {string} id */
  control: (id) => () => {
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
  // Closing the modal aborts whatever /docs request is still in flight.
  docsClose: () => closeDocs(),
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
// This figure only ever reads its own `.graph`/`.docs` keys; `.sources`/`.testimony` stay here
// too so the shape matches what test/atlas-request-reuse-acceptance.test.ts already asserts.
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

// A seeded value only ever overrides a <select> when it names one of that select's own
// options; a malformed value (an unknown days/sort/limit) leaves the element at whatever its
// markup already defaults to, and nothing throws.
/** @param {any} select @param {string | undefined} value */
const applySeed = (select, value) => {
  if (value === undefined || !select) return
  if ([...select.options].some((/** @type {any} */ o) => o.value === value)) select.value = value
}

// The seeded person id wins only when it names someone the API actually returned; otherwise
// the figure falls back to the first person in the list, exactly like the page did before the
// split.
/** @param {Person[]} people @param {string | undefined} seeded */
const resolvePerson = (people, seeded) => (seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? ''))

// Mounts figure 1 into `root` (#workspace): populates the sentence's controls from `people`
// and `initial`, wires every listener, and runs the first load. Nothing here reaches into
// figure 2's DOM, and nothing in figure 2 reaches into this one.
/** @param {any} root @param {{ people: Person[], initial: Seed, peopleError?: PeopleError }} args */
export const mount = (root, { people, initial, peopleError = null }) => {
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
  /** @type {import('../format.js').Measure | null} */
  let measure = null
  /** @type {Map<string, Layout>} */
  const layoutCache = new Map()
  /** @type {string | null} */
  let selected = null
  let mask = true
  let zoom = 1
  let source = SOURCE_SEGMENTS.some(([v]) => v === initial.source) ? /** @type {string} */ (initial.source) : 'all'
  let requestId = 0
  /** @type {AbortController | null} */
  let controller = null
  let docsId = 0
  /** @type {AbortController | null} */
  let docsController = null
  /** @type {AbortController | null} */
  let candidateController = null

  const nextRequestId = () => ++requestId
  const currentRequestId = () => requestId
  const currentDocsId = () => docsId
  const cancelDocs = () => {
    ++docsId
    docsController?.abort()
    return docsId
  }

  const measured = () => (measure ??= createCanvasMeasure())
  const controlValues = () => ({ days: $('days').value, sort: $('sort').value, limit: $('limit').value, source })
  const graphQuery = () => api.params(controlValues())
  const daysLabel = () => $('days').selectedOptions[0].textContent.toLowerCase()
  const getZoom = () => zoom
  /** @param {number} z */
  const setZoomLevel = (z) => {
    zoom = Math.max(1, Math.min(2, z))
    return zoom
  }
  const getSelected = () => selected
  /** @param {string | null} id */
  const setSelected = (id) => {
    selected = id
  }
  const getMask = () => mask
  /** @param {boolean} on */
  const setMask = (on) => {
    mask = on
  }

  const getLayout = () => {
    const person = /** @type {Graph} */ (graph).person
    const key = layoutKey(person, nodes, $('sort').value, $('limit').value)
    if (!layoutCache.has(key)) layoutCache.set(key, pack(measured(), nodes, centerLabel(measured(), person.name), $('sort').value))
    return /** @type {Layout} */ (layoutCache.get(key))
  }

  // Only the map's own width and the zoom controls: the strip and the testimony lists belong
  // to figure 2's own ResizeObserver now (issue #92).
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
    paintSelection({ nodes, links, selected: getSelected(), search: $('search').value, layout: currentLayout, mode, sort: $('sort').value, onChoose: (id) => handlers.pick(id), mask: getMask(), personTestimony: graph?.stats?.testimony })

  const paintCurrentInspector = () =>
    inspect({ graph, nodes, links, selected: getSelected(), sort: $('sort').value, daysLabel: daysLabel(), onChoose: (id) => handlers.pick(id), onShowDocs: loadDocs })

  const drawCurrentMap = () => {
    const current = /** @type {Graph} */ (graph)
    currentLayout = getLayout()
    drawMap({ layout: currentLayout, personName: current.person.name, about: current.stats?.about, mode, sort: $('sort').value, onChoose: (id) => handlers.pick(id), personTestimony: current.stats?.testimony })
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

  // The only path to GET /docs: the reader pressed the button in the inspector. The modal
  // opens first, with the loading copy or the memoized rows, and the fetch runs behind it.
  /** @param {Term | null} n */
  const loadDocs = async (n) => {
    const id = cancelDocs()
    const controller = new AbortController()
    docsController = controller
    if (!$('docs') || !graph || !$('person').value) return
    paintDocsTitle({ term: n, personName: graph.person.name })
    const dialog = $('docsDialog')
    if (dialog && !dialog.open) dialog.showModal()
    const person = $('person').value
    const base = graphQuery()
    const query = docsQuery(base, n)
    const key = scopeKeys(person, base, n).docs
    // A hit paints straight from the memo, so re-entering the unselected inspector after a
    // sort change or a view-mode switch shows the same five documents without a second
    // request. A miss still shows the loading copy first.
    const cached = readScope('docs', key)
    if (!cached) paintDocsLoading()
    try {
      const data = await fromScope('docs', key, () => api.loadDocs(person, query, controller.signal))
      if (id !== currentDocsId()) return
      paintDocs(data)
    } catch (e) {
      if (id === currentDocsId() && !aborted(e)) paintDocsError(() => loadDocs(n))
    }
  }

  // The candidate queue has no panel on the atlas any more (it is a maintenance list, not a
  // reading); the flow stays for a page that carries `#candidateList`, and is a no-op without it.
  const loadCandidatesFlow = async () => {
    if (!$('candidateList')) return
    candidateController?.abort()
    const control = new AbortController()
    candidateController = control
    paintCandidatesLoading()
    try {
      const data = await api.loadCandidates(api.candidatesQuery({ days: $('days').value }), control.signal)
      if (!control.signal.aborted) paintCandidates(data)
    } catch (e) {
      if (!aborted(e)) paintCandidatesError(loadCandidatesFlow)
    }
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
      paintColumns({ nodes, links, selected: getSelected(), search: $('search').value, sort: $('sort').value, mode, onChoose: (id) => handlers.pick(id), personTestimony: current.stats?.testimony })
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

  // Resets the reader's state, not the painted surfaces: the old map, columns and overflow
  // list stay on screen until render() replaces them, so nothing under them moves while a load
  // is in flight (see load()).
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
    $('atlasStats').textContent = graph ? `${fmt(graph.stats?.about)} docs · ${sourceLabels[source] || source}` : ''
  }

  const closeDocs = () => {
    cancelDocs()
    const dialog = $('docsDialog')
    if (dialog?.open) dialog.close()
  }

  const signal = () => /** @type {AbortController} */ (controller).signal

  // A reload keeps the previous map, columns, legend and inspector on screen, dimmed by the
  // `is-loading` class, and swaps them in one go when the data lands. Blanking them first made
  // the map column collapse from its drawn height to the empty-state minimum for the length of
  // the request. Only the very first load, with nothing to keep, shows the loading copy in
  // place of a map.
  const load = async () => {
    const id = nextRequestId()
    controller?.abort()
    controller = new AbortController()
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
    root.classList.add('is-loading')
    if (first) {
      $('viewport').innerHTML = '<div class="empty">Carregando o campo de palavras…</div>'
      $('inspector').textContent = 'Aguardando dados.'
    }
    // A failed GET /api/people (app.js's own boot()) is not the same thing as a seed with no
    // one in it: an outage gets the same "no fictional graph" copy master showed, with a
    // retry that reloads the page (the only way this figure can ask app.js to fetch again,
    // since the person list is fetched once, up in the shell, and handed down).
    if (peopleError) {
      busy = false
      $('status').classList.add('error')
      $('status').textContent = 'Não foi possível carregar dados reais.'
      $('viewport').hidden = false
      $('columns').hidden = true
      $('overflow').hidden = true
      $('legend').textContent = ''
      $('viewport').innerHTML =
        '<div class="empty">Falha de rede ou base indisponível.<br>Nenhum grafo fictício será exibido.<br><br><button class="quiet-button" id="retry">Tentar novamente</button></div>'
      $('retry').addEventListener('click', () => location.reload())
      $('inspector').textContent = 'Use tentar novamente quando a API estiver disponível.'
      $('viewport').setAttribute('aria-busy', 'false')
      root.classList.remove('is-loading')
      return
    }
    if (!people.length) {
      busy = false
      $('status').textContent = 'Nenhuma pessoa cadastrada.'
      $('viewport').innerHTML = '<div class="empty">A lista de pessoas está vazia.<br>Cadastre pessoas em seed.json e rode o índice.</div>'
      $('inspector').textContent = 'Cadastre pessoas em seed.json e rode o índice.'
      $('viewport').setAttribute('aria-busy', 'false')
      root.classList.remove('is-loading')
      return
    }
    try {
      const person = $('person').value
      const query = graphQuery()
      const data = await fromScope('graph', scopeKeys(person, query).graph, () => api.loadGraph(person, query, signal()))
      if (id !== currentRequestId()) return
      graph = data
      busy = false
      $('status').textContent = `${fmt(data.stats.about)} documentos sobre ${data.person.name} neste recorte.`
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
        root.classList.remove('is-loading')
      }
    }
  }

  // The controls debounce; the first load and the retry button do not. createHandlers keeps
  // calling whatever `load` it is handed synchronously, so its own contract (and the tests
  // written against it) is untouched — the coalescing lives here, at the wiring site.
  const debouncedLoad = debounce(load)

  const handlers = createHandlers({
    paintCurrentSelection,
    choose,
    getSelected,
    load: debouncedLoad,
    loadCandidates: loadCandidatesFlow,
    setMode,
    setZoom,
    getZoomLevel: getZoom,
    clearSearch: () => {
      $('search').value = ''
    },
    canClear: () => !busy && !!graph,
    updateHeader,
    setSource: (value) => {
      source = value
      $('source').value = value
    },
    toggleMask: () => {
      setMask(!getMask())
      $('mask').setAttribute('aria-pressed', String(getMask()))
      if (graph && !busy) paintCurrentSelection()
    },
    closeDocs,
    docsOpen: () => !!$('docsDialog')?.open,
  })

  // The sentence's controls: source is built here (it has no static markup), the rest keep
  // their design-5.html options and only take a seeded value when it names one of them.
  $('source').innerHTML = SOURCE_SEGMENTS.map(([value, text]) => `<option value="${value}">${sourceLabels[value] ?? text}</option>`).join('')
  $('source').value = source
  $('person').innerHTML = ''
  for (const p of people) $('person').add(new Option(p.name, p.id))
  $('person').value = resolvePerson(people, initial.person)
  applySeed($('days'), initial.days)
  applySeed($('sort'), initial.sort)
  applySeed($('limit'), initial.limit)

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
  for (const id of ['viewport', 'columns'])
    $(id).addEventListener('click', (/** @type {MouseEvent} */ e) => handlers.background(/** @type {Element | null} */ (e.target)))
  $('docsClose').addEventListener('click', handlers.docsClose)
  // A click on the backdrop lands on the dialog element itself, never on its children.
  $('docsDialog').addEventListener('click', (/** @type {MouseEvent} */ e) => {
    if (e.target === $('docsDialog')) handlers.docsClose()
  })
  $('docsDialog').addEventListener('close', () => cancelDocs())
  document.addEventListener('keydown', handlers.keydown)
  new ResizeObserver(resizeMap).observe($('viewport'))
  document.fonts?.ready?.then(() => {
    layoutCache.clear()
    if (graph && !busy) render()
  })
  loadCandidatesFlow()
  load()
}
