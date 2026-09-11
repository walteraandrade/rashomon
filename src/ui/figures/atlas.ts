// Figure 1, end to end. Side-effect free outside a browser: mount() only runs once the shell
// hands it a root element, so node:test can import the pieces without a document.

import * as api from '../api.js'
import { fmt, html, kinds, label, SOURCE_SEGMENTS, sourceLabels, type Graph, type Layout, type Link, type Measure, type Term } from '../format.js'
import { centerLabel, pack } from '../layout.js'
import {
  createCanvasMeasure,
  drawMap,
  inspect,
  paintAtlasLoading,
  paintCandidates,
  paintCandidatesError,
  paintCandidatesLoading,
  paintColumns,
  paintSelection,
  type Sparkline,
} from '../render.js'
import * as docsCard from '../docs-card.js'
import { debounce, fromScope } from '../state.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { person?: string; days?: string; source?: string; sort?: string; limit?: string }
// Distinct from an empty `people` array: an outage must never paint as "no one registered yet".
export type PeopleError = unknown

// Typed loosely on purpose: per-element values avoid casting at ~100 call sites.
const $ = (id: string): any => document.getElementById(id)

const OUTAGE =
  '<div class="empty"><img class="pet" src="/pet-caracara-perched.png" alt="" width="26" height="37">Falha de rede ou base indisponível.<br>Nenhum grafo fictício será exibido.<br><br><button class="quiet-button" id="retry">Tentar novamente</button></div>'

const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError'

export type HandlerActions = {
  paintCurrentSelection?: () => void
  choose?: (id: string | null) => void
  getSelected?: () => string | null
  load?: () => void
  loadCandidates?: () => void
  setMode?: (mode: string) => void
  setZoom?: (zoom: number) => void
  getZoomLevel?: () => number
  clearSearch?: () => void
  canClear?: () => boolean
  updateHeader?: () => void
  setSource?: (source: string) => void
  toggleMask?: () => void
  closeDocs?: () => void
  docsOpen?: () => boolean
}

// Every listener resolves to one entry here, testable without a document. `search` only
// repaints the selection — rebuilding the inspector would wipe documents already loaded.
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
}: HandlerActions) => ({
  search: () => {
    paintCurrentSelection()
  },
  clear: () => {
    if (!canClear()) return
    clearSearch()
    choose(null)
  },
  // Selecting is a toggle: clicking again releases without requiring the clear button.
  pick: (id: string | null) => {
    choose(id !== null && id === getSelected() ? null : id)
  },
  // A click on empty space releases the selection; data-person-docs is excluded so her card
  // open does not immediately close itself by bubbling into this handler.
  background: (target: Element | null) => {
    if (!getSelected()) return
    if (target && target.closest('[data-node], [data-col], [data-person-docs]')) return
    choose(null)
  },
  // Escape closes the docs card first, then clears the selection so the word stays visible.
  keydown: (e: { key: string }) => {
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
  mask: () => toggleMask(),
  control: (id: string) => () => {
    if (id === 'days') loadCandidates()
    updateHeader()
    load()
  },
  source: (value: string) => () => {
    setSource(value)
    load()
    updateHeader()
  },
  zoomIn: () => setZoom(getZoomLevel() + 0.25),
  zoomOut: () => setZoom(getZoomLevel() - 0.25),
  zoomReset: () => setZoom(1),
  docsClose: () => closeDocs(),
})

export const layoutKey = (person: Person | undefined, terms: Term[], sort: string, limit: string) =>
  JSON.stringify(person ? [person.id, person.name, sort, limit, terms.map((n) => [n.id, n.term, n.kind, n.count, n.pmi])] : [])

// `sort` and `min` are dropped: parseDocsQuery reads neither, so keeping them would make every
// sort change look like a new query to the memo and any HTTP cache.
export const docsQuery = (base: URLSearchParams, n: Term | null) =>
  api.docsParams({ days: base.get('days') ?? '30', source: base.get('source') ?? 'all', term: n ? n.term : '', kind: n ? n.kind : 'all' })

// One cache key per scope built from the filters that route actually reads, so a control the
// route ignores cannot evict it. `.sources`/`.testimony` are included to match test assertions.
export const scopeKeys = (personId: string, graphParams: URLSearchParams, term: Term | null = null) => ({
  graph: personId + '?' + graphParams,
  sources: personId + '?' + api.narrowToSources(graphParams),
  docs: personId + '?' + docsQuery(graphParams, term),
  testimony: personId + '?' + api.narrowToTestimony(graphParams),
})

const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

const resolvePerson = (people: Person[], seeded: string | undefined) =>
  seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? '')

export const mount = (root: FigureRoot, { people, initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let graph: Graph | null = null
  let nodes: Term[] = []
  let links: Link[] = []
  let busy = false
  let mode = 'map'
  let currentLayout: Layout | null = null
  let lastMapWidth = 0
  let measure: Measure | null = null
  const layoutCache = new Map<string, Layout>()
  let selected: string | null = null
  let mask = true
  let zoom = 1
  let source = SOURCE_SEGMENTS.some(([v]) => v === initial.source) ? (initial.source as string) : 'all'
  let requestId = 0
  let controller: AbortController | null = null
  let candidateController: AbortController | null = null
  let sparkController: AbortController | null = null
  let sparkline: Sparkline | null = null

  const nextRequestId = () => ++requestId
  const currentRequestId = () => requestId

  const measured = () => (measure ??= createCanvasMeasure())
  const controlValues = () => ({ days: $('days').value, sort: $('sort').value, limit: $('limit').value, source })
  const graphQuery = () => api.params(controlValues())
  const daysLabel = () => $('days').selectedOptions[0].textContent.toLowerCase()
  const getZoom = () => zoom
  const setZoomLevel = (z: number) => {
    zoom = Math.max(1, Math.min(2, z))
    return zoom
  }
  const getSelected = () => selected
  const setSelected = (id: string | null) => {
    selected = id
  }
  const getMask = () => mask
  const setMask = (on: boolean) => {
    mask = on
  }

  const getLayout = () => {
    const person = (graph as Graph).person
    const key = layoutKey(person, nodes, $('sort').value, $('limit').value)
    if (!layoutCache.has(key)) layoutCache.set(key, pack(measured(), nodes, centerLabel(measured(), person.name), $('sort').value))
    return layoutCache.get(key) as Layout
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

  const setZoom = (value: number) => {
    const vp = $('viewport')
    const oldWidth = Math.max(1, vp.scrollWidth)
    const center = (vp.scrollLeft + vp.clientWidth / 2) / oldWidth
    setZoomLevel(value)
    resizeMap()
    vp.scrollLeft = center * vp.scrollWidth - vp.clientWidth / 2
  }

  const paintCurrentSelection = () =>
    paintSelection({ nodes, links, selected: getSelected(), search: $('search').value, layout: currentLayout, mode, sort: $('sort').value, onChoose: (id) => handlers.pick(id), onShowPerson: showPersonDocs, personName: graph?.person?.name ?? '', about: graph?.stats?.about, mask: getMask(), personTestimony: graph?.stats?.testimony })

  const paintCurrentInspector = () =>
    inspect({
      graph,
      nodes,
      links,
      selected: getSelected(),
      sort: $('sort').value,
      daysLabel: daysLabel(),
      onChoose: (id) => handlers.pick(id),
      sparkline: getSelected() ? sparkline : null,
    })

  const loadSparkline = async (term: Term) => {
    sparkController?.abort()
    const control = new AbortController()
    sparkController = control
    sparkline = { status: 'loading' }
    paintCurrentInspector()
    try {
      const rows = await api.loadTimeline($('person').value, api.timelineParams({ term: term.term, kind: term.kind }), control.signal)
      if (control.signal.aborted) return
      sparkline = { status: 'ready', counts: (rows as { count: number }[]).map((r) => r.count) }
    } catch (e) {
      if (aborted(e)) return
      sparkline = { status: 'empty' }
    }
    paintCurrentInspector()
  }

  const drawCurrentMap = () => {
    const current = graph as Graph
    currentLayout = getLayout()
    drawMap({ layout: currentLayout, personName: current.person.name, about: current.stats?.about, mode, sort: $('sort').value, onChoose: (id) => handlers.pick(id), onShowPerson: showPersonDocs, personTestimony: current.stats?.testimony })
    resizeMap()
    paintCurrentSelection()
    $('viewport').scrollLeft = Math.max(0, ($('viewport').scrollWidth - $('viewport').clientWidth) / 2)
  }

  const choose = (id: string | null) => {
    setSelected(id)
    const chosen = nodes.find((n) => n.id === id)
    sparkline = chosen ? { status: 'loading' } : null
    docsCard.close()
    paintCurrentSelection()
    paintCurrentInspector()
    $('selectionNote').textContent = chosen ? `${label(chosen)} selecionado. Detalhes atualizados.` : 'Seleção limpa.'
    if (chosen) {
      showDocs(chosen)
      loadSparkline(chosen)
    }
  }

  const showPersonDocs = () => {
    if (getSelected() !== null) choose(null)
    showDocs(null)
  }

  const showDocs = (n: Term | null) => {
    if (!graph || !$('person').value) return
    docsCard.open({
      kicker: n ? `Documentos com ${kinds[n.kind] ? kinds[n.kind].toLowerCase() : 'o termo'}` : 'Documentos sobre',
      title: n ? label(n) : graph.person.name,
      sides: [{ personId: $('person').value, personName: graph.person.name, query: docsQuery(graphQuery(), n) }],
    })
  }

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
      paintColumns({ nodes, links, selected: getSelected(), search: $('search').value, sort: $('sort').value, mode, onChoose: (id) => handlers.pick(id), onShowPerson: showPersonDocs, personName: current.person.name, about: current.stats?.about, personTestimony: current.stats?.testimony })
    } else {
      $('viewport').innerHTML = '<div class="empty">Nenhum termo neste recorte.<br>Experimente outra pessoa ou um período maior.</div>'
      $('columns').innerHTML = '<div class="empty">Nenhum termo neste recorte.</div>'
      $('legend').textContent = 'Sem dados para desenhar.'
      $('overflow').hidden = true
      currentLayout = null
    }
    paintCurrentInspector()
  }

  const setMode = (next: string) => {
    mode = next
    docsCard.close()
    render()
  }

  // State is reset before the request; painted surfaces stay until render() replaces them.
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

  const signal = () => (controller as AbortController).signal

  // First paint holds the map's silhouette. A refetch dims what is already on screen so the
  // column does not collapse. Outage and empty-list return before either, or they would flash.
  const load = async () => {
    const id = nextRequestId()
    controller?.abort()
    controller = new AbortController()
    docsCard.close()
    resetGraph()
    const first = !graph
    busy = true
    graph = null
    nodes = []
    links = []
    $('status').classList.remove('error')
    // An outage shows the error illustration; retry reloads the page (the only path back to
    // app.ts, which fetches the person list once and hands it down).
    if (peopleError) {
      busy = false
      $('status').classList.add('error')
      $('status').textContent = 'Não foi possível carregar dados reais.'
      $('viewport').hidden = false
      $('columns').hidden = true
      $('overflow').hidden = true
      $('legend').textContent = ''
      $('viewport').innerHTML = OUTAGE
      $('retry').addEventListener('click', () => location.reload())
      $('inspector').textContent = 'Use tentar novamente quando a API estiver disponível.'
      $('viewport').setAttribute('aria-busy', 'false')
      root.classList.remove('is-loading')
      return
    }
    if (!people.length) {
      busy = false
      $('status').textContent = 'Nenhuma pessoa cadastrada.'
      $('viewport').innerHTML =
        '<div class="empty">A lista de pessoas está vazia.<br>Cadastre pessoas em seed.json e rode o índice.<br><br><button class="quiet-button" id="retry">Tentar novamente</button></div>'
      $('retry').addEventListener('click', () => location.reload())
      $('inspector').textContent = 'Cadastre pessoas em seed.json e rode o índice.'
      $('viewport').setAttribute('aria-busy', 'false')
      root.classList.remove('is-loading')
      return
    }
    $('status').textContent = 'Lendo o recorte.'
    $('viewport').setAttribute('aria-busy', 'true')
    if (first) paintAtlasLoading()
    else root.classList.add('is-loading')
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
      $('viewport').innerHTML = OUTAGE
      $('retry').addEventListener('click', load)
      $('inspector').textContent = 'Use tentar novamente quando a API estiver disponível.'
    } finally {
      if (id === currentRequestId()) {
        $('viewport').setAttribute('aria-busy', 'false')
        root.classList.remove('is-loading')
      }
    }
  }

  // Controls debounce; first load and retry do not. createHandlers always calls `load`
  // synchronously, so coalescing lives here at the wiring site.
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
    closeDocs: () => docsCard.close(),
    docsOpen: docsCard.isOpen,
  })

  $('source').innerHTML = html`${SOURCE_SEGMENTS.map(([value, text]) => html`<option value="${value}">${sourceLabels[value] ?? text}</option>`)}`
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
    $(id).addEventListener('click', (e: MouseEvent) => handlers.background(e.target as Element | null))
  document.addEventListener('keydown', handlers.keydown)
  new ResizeObserver(resizeMap).observe($('viewport'))
  document.fonts?.ready?.then(() => {
    layoutCache.clear()
    if (graph && !busy) render()
  })
  loadCandidatesFlow()
  load()
}
