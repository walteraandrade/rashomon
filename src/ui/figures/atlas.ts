// Figure 1, end to end: the sentence (person, days, source, sort, limit), search, pick/
// background, Escape, the map/columns mode toggle, the mask toggle, zoom, the map/columns/
// inspector painters, the documents modal (its markup sits outside #workspace, but only this
// figure ever opens it) and this figure's own stats badge. Importing this module is side-effect
// free outside a browser: mount() runs only once app.ts hands it a root element and the
// fetched person list, which is what lets node:test import the pieces below with no document.

import * as api from '../api.js'
import { fmt, kinds, label, SOURCE_SEGMENTS, sourceLabels, type Graph, type Layout, type Link, type Measure, type Term } from '../format.js'
import { centerLabel, pack } from '../layout.js'
import {
  createCanvasMeasure,
  drawMap,
  inspect,
  paintCandidates,
  paintCandidatesError,
  paintCandidatesLoading,
  paintColumns,
  paintSelection,
} from '../render.js'
import * as docsCard from '../docs-card.js'
import { debounce, fromScope } from '../state.js'

// The section element the shell mounts into. Only `classList` is ever read off it, and the
// suites mount against a DOM stand-in rather than a real element, so the contract is that one
// property instead of the whole HTMLElement surface.
export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { person?: string; days?: string; source?: string; sort?: string; limit?: string }
// Whatever GET /api/people rejected with, or null when it answered. Distinct from an empty
// `people` array: an outage must never paint as "no one is registered yet" (issue #92).
export type PeopleError = unknown

// Elements this figure owns by id. The markup in design-5.html guarantees each one exists
// (the sentence and the toolbar live inside #workspace; the shared #docsDialog is not this
// figure's). The values read off them (select.value, button.disabled) are per-element, so this
// is typed loosely on purpose rather than casting at all ~100 call sites.
const $ = (id: string): any => document.getElementById(id)

// The one box on this page where a picture is allowed: nothing is on screen to compete with it,
// because the atlas has failed. Both ways in -- an /api/people outage and a failed graph fetch --
// paint it, since to a reader they are the same box saying the same thing. Figures 2 and 3 print
// the same outage in words and stay wordless: all three fail together, and three birds would read
// as decoration rather than as one failure.
const OUTAGE =
  '<div class="empty"><img class="pet" src="/pet-caracara-perched.png" alt="" width="26" height="37">Falha de rede ou base indisponível.<br>Nenhum grafo fictício será exibido.<br><br><button class="quiet-button" id="retry">Tentar novamente</button></div>'

// A caught value is `unknown`; the flows below only ever ask whether the browser aborted the
// request, so this is the one place that inspects it.
const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError'

// every action is optional so a test can inject only the ones a criterion is about
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

// The event table. Every DOM listener this figure installs resolves to exactly one entry
// here, and each entry may only call the actions it is handed, so the mapping is inspectable
// without a document. `search` is the load-bearing one: highlighting must repaint the
// selection and nothing else, since rebuilding the inspector would wipe the documents the
// reader already loaded (issue #28). There is no `resetOutlet` action any more: the outlet in
// focus belongs to figure 2 now, and only figure 2's own controls release it (issue #92).
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
  // Selecting is a toggle: clicking the selected term again lets it go. Without it the only
  // way back to the clean map was the clear button, which is off in the toolbar, far from the
  // word the reader is looking at.
  pick: (id: string | null) => {
    choose(id !== null && id === getSelected() ? null : id)
  },
  // A click that lands on nothing selectable is the other way out. The listener sits on the
  // map viewport and the list, so the toolbar and the inspector's own buttons never reach it;
  // inside those two, anything without a data-node/data-col/data-person-docs is empty space.
  // The person's own entry point has to be in that list: it sits inside the viewport, so the
  // click that opens her card bubbles straight into this handler, which would close it again.
  background: (target: Element | null) => {
    if (!getSelected()) return
    if (target && target.closest('[data-node], [data-col], [data-person-docs]')) return
    choose(null)
  },
  // Escape closes the documents modal when it is open, and only then clears the selection:
  // the reader who closes the texts of a word must still be looking at that word.
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
  // Paint only: the per-term testimony always travels with the graph (api.ts's testimony=1).
  mask: () => toggleMask(),
  // One handler per control id, so the period control is the only one that refetches the
  // candidate queue.
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
  // Closing the modal aborts whatever /docs request is still in flight.
  docsClose: () => closeDocs(),
})

// The layout cache key: the same person, sort, term limit and term list must reuse the same
// packing, and any change to them must not.
export const layoutKey = (person: Person | undefined, terms: Term[], sort: string, limit: string) =>
  JSON.stringify(person ? [person.id, person.name, sort, limit, terms.map((n) => [n.id, n.term, n.kind, n.count, n.pmi])] : [])

// The docs panel reuses the graph querystring, narrowed to one term and five rows. A null
// term means "documents about the person", which is `term=''` plus `kind=all`. `sort` and
// `min` are dropped (issue #43): src/query.ts's parseDocsQuery reads neither, so leaving
// them in made the same five rows look like a new query on every sort change.
export const docsQuery = (base: URLSearchParams, n: Term | null) =>
  api.docsParams({ days: base.get('days') ?? '30', source: base.get('source') ?? 'all', term: n ? n.term : '', kind: n ? n.kind : 'all' })

// Issue #43: one cache key per scope, built from the filters that scope's route actually
// reads, so a change to a control the route ignores cannot evict it. The keys are the
// querystrings themselves, which is what makes them honest: whatever ends up in the URL ends
// up in the key, and a parameter added to a route later cannot silently share a stale entry.
// This figure only ever reads its own `.graph`/`.docs` keys; `.sources`/`.testimony` stay here
// too so the shape matches what test/atlas-request-reuse-acceptance.test.ts already asserts.
export const scopeKeys = (personId: string, graphParams: URLSearchParams, term: Term | null = null) => ({
  graph: personId + '?' + graphParams,
  sources: personId + '?' + api.narrowToSources(graphParams),
  docs: personId + '?' + docsQuery(graphParams, term),
  testimony: personId + '?' + api.narrowToTestimony(graphParams),
})

// A seeded value only ever overrides a <select> when it names one of that select's own
// options; a malformed value (an unknown days/sort/limit) leaves the element at whatever its
// markup already defaults to, and nothing throws.
const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

// The seeded person id wins only when it names someone the API actually returned; otherwise
// the figure falls back to the first person in the list, exactly like the page did before the
// split.
const resolvePerson = (people: Person[], seeded: string | undefined) =>
  seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? '')

// Mounts figure 1 into `root` (#workspace): populates the sentence's controls from `people`
// and `initial`, wires every listener, and runs the first load. Nothing here reaches into
// figure 2's DOM, and nothing in figure 2 reaches into this one.
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
    inspect({ graph, nodes, links, selected: getSelected(), sort: $('sort').value, daysLabel: daysLabel(), onChoose: (id) => handlers.pick(id) })

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
    docsCard.close()
    paintCurrentSelection()
    paintCurrentInspector()
    const chosen = nodes.find((n) => n.id === id)
    $('selectionNote').textContent = chosen ? `${label(chosen)} selecionado. Detalhes atualizados.` : 'Seleção limpa.'
    // Picking a word IS the request for its texts, so the card follows the selection: it opens
    // on the word just chosen and goes away with the selection it belonged to.
    if (chosen) showDocs(chosen)
    else docsCard.close()
  }

  // The person's card replaces whatever word was on screen: leaving the word is what asking for
  // the whole person means, so the selection goes first and her documents open after it.
  const showPersonDocs = () => {
    if (getSelected() !== null) choose(null)
    showDocs(null)
  }

  // This figure's two readings, handed to the shared card: a word ("Documentos com palavra")
  // and the person at the centre ("Documentos sobre"). The recorte is this figure's own.
  const showDocs = (n: Term | null) => {
    if (!graph || !$('person').value) return
    docsCard.open({
      kicker: n ? `Documentos com ${kinds[n.kind] ? kinds[n.kind].toLowerCase() : 'o termo'}` : 'Documentos sobre',
      title: n ? label(n) : graph.person.name,
      sides: [{ personId: $('person').value, personName: graph.person.name, query: docsQuery(graphQuery(), n) }],
    })
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

  const signal = () => (controller as AbortController).signal

  // A reload keeps the previous map, columns, legend and inspector on screen, dimmed by the
  // `is-loading` class, and swaps them in one go when the data lands. Blanking them first made
  // the map column collapse from its drawn height to the empty-state minimum for the length of
  // the request. Only the very first load, with nothing to keep, shows the loading copy in
  // place of a map.
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
    $('status').textContent = 'Carregando a base local…'
    $('viewport').setAttribute('aria-busy', 'true')
    root.classList.add('is-loading')
    if (first) {
      $('viewport').innerHTML = '<div class="empty">Carregando o campo de palavras…</div>'
      $('inspector').textContent = 'Aguardando dados.'
    }
    // A failed GET /api/people (app.ts's own boot()) is not the same thing as a seed with no
    // one in it: an outage gets the same "no fictional graph" copy master showed, with a
    // retry that reloads the page (the only way this figure can ask app.ts to fetch again,
    // since the person list is fetched once, up in the shell, and handed down).
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
    closeDocs: () => docsCard.close(),
    docsOpen: docsCard.isOpen,
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
