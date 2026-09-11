// Figure 2. Side-effect free outside a browser. Never imports or is imported by atlas.ts.

import * as api from '../api.js'
import { html, SOURCE_SEGMENTS, sourceLabels, type OutletRow, type Testimony } from '../format.js'
import * as docsCard from '../docs-card.js'
import { paintOutlets, paintOutletsError, paintOutletsLoading, paintStrip, paintTestimony, paintTestimonyError, paintTestimonyLoading } from '../render.js'
import { debounce, fromScope, readScope } from '../state.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { person?: string; days?: string; source?: string }
// Distinct from an empty `people` array: an outage must never paint as "no one registered yet".
export type PeopleError = unknown

const $ = (id: string): any => document.getElementById(id)

const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError'

const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

const resolvePerson = (people: Person[], seeded: string | undefined) =>
  seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? '')

export const mount = (root: FigureRoot, { people, initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let testimony: Testimony | null = null
  let outletRows: OutletRow[] | null = null
  let outlet = 'all'
  let lastStripWidth = 0
  let requestId = 0
  let controller: AbortController | null = null

  const controlValues = () => ({ days: $('testimonyDays').value, sort: 'count', limit: '18', source: $('testimonySource').value })
  const scopeKey = (personId: string, params: URLSearchParams) => personId + '?' + params

  const repaint = () => {
    if (testimony) {
      paintTestimony({ data: testimony, domain: outlet })
      paintStrip({ data: testimony, domain: outlet, onPick: pickOutlet, width: lastStripWidth || undefined })
    }
    if (outletRows) paintOutlets({ rows: outletRows, testimony, domain: outlet, onPick: pickOutlet })
  }

  // Picking an outlet repaints from existing data and opens the docs card; releasing closes it.
  const pickOutlet = (d: string) => {
    if (d === outlet) return
    outlet = d
    repaint()
    if (d === 'all') docsCard.close()
    else showOutletDocs(d)
  }

  const releaseOutlet = () => pickOutlet('all')

  const showOutletDocs = (d: string) => {
    const personId = $('testimonyPerson').value
    if (!personId) return
    const person = people.find((p) => p.id === personId)
    const values = controlValues()
    docsCard.open({
      kicker: 'Documentos de',
      title: d,
      sides: [{ personId, personName: person?.name ?? personId, query: api.docsParams({ days: values.days, source: values.source, domain: d }) }],
    })
  }

  const loadSourcesFlow = async (id: number, signal: AbortSignal) => {
    const person = $('testimonyPerson').value
    const params = api.sourcesParams(controlValues())
    const key = scopeKey(person, params)
    if (!readScope('sources', key)) {
      if (outletRows) $('outletList').classList.add('is-loading')
      else paintOutletsLoading()
    }
    try {
      const rows = await fromScope('sources', key, () => api.loadSources(person, params, signal))
      if (id !== requestId) return
      outletRows = rows
      repaint()
    } catch (e) {
      if (id === requestId && !aborted(e)) paintOutletsError()
    }
  }

  const loadTestimonyFlow = async (id: number, signal: AbortSignal) => {
    const person = $('testimonyPerson').value
    const params = api.testimonyParams(controlValues())
    const key = scopeKey(person, params)
    if (!readScope('testimony', key)) {
      if (testimony) {
        $('testimonyList').classList.add('is-loading')
        $('strip').classList.add('is-loading')
      } else paintTestimonyLoading()
    }
    try {
      const data = await fromScope('testimony', key, () => api.loadTestimony(person, params, signal))
      if (id !== requestId) return
      testimony = data
      lastStripWidth = $('strip').clientWidth || 0
      repaint()
    } catch (e) {
      if (id === requestId && !aborted(e)) {
        testimony = null
        paintTestimonyError()
      }
    }
  }

  const load = () => {
    const id = ++requestId
    controller?.abort()
    controller = new AbortController()
    outlet = 'all'
    if (peopleError) {
      testimony = null
      outletRows = null
      $('testimonyList').innerHTML =
        '<p class="note">Falha de rede ou base indisponível.<br>Nenhuma avaliação fictícia será exibida.<br><br><button class="quiet-button" id="testimonyRetry">Tentar novamente</button></p>'
      $('outletList').textContent = ''
      $('strip').hidden = true
      $('testimonyRetry')?.addEventListener('click', () => location.reload())
      return
    }
    if (!people.length) {
      testimony = null
      outletRows = null
      $('testimonyList').textContent = 'Nenhuma pessoa cadastrada.'
      $('outletList').textContent = ''
      $('strip').hidden = true
      return
    }
    loadSourcesFlow(id, controller.signal)
    loadTestimonyFlow(id, controller.signal)
  }

  const debouncedLoad = debounce(load)

  const onControlChange = () => {
    outlet = 'all'
    debouncedLoad()
  }

  const background = (target: Element | null) => {
    if (target && target.closest('[data-domain], [data-testimony-domain], [data-strip-domain]')) return
    releaseOutlet()
  }

  $('testimonySource').innerHTML = html`${SOURCE_SEGMENTS.map(([value, text]) => html`<option value="${value}">${sourceLabels[value] ?? text}</option>`)}`
  applySeed($('testimonySource'), initial.source)
  $('testimonyPerson').innerHTML = ''
  for (const p of people) $('testimonyPerson').add(new Option(p.name, p.id))
  $('testimonyPerson').value = resolvePerson(people, initial.person)
  applySeed($('testimonyDays'), initial.days)

  $('testimonyPerson').addEventListener('change', onControlChange)
  $('testimonyDays').addEventListener('change', onControlChange)
  $('testimonySource').addEventListener('change', onControlChange)
  for (const id of ['strip', 'testimonyList', 'outletList'])
    $(id).addEventListener('click', (e: MouseEvent) => background(e.target as Element | null))
  new ResizeObserver(() => {
    const width = $('strip').clientWidth
    if (testimony && width && width !== lastStripWidth) {
      lastStripWidth = width
      paintStrip({ data: testimony, domain: outlet, onPick: pickOutlet, width })
    }
  }).observe($('strip'))

  load()
}
