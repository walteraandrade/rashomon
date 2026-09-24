// Figure 2. Side-effect free outside a browser. Never imports or is imported by atlas.ts.

import * as api from '../api.js'
import { html, SOURCE_SEGMENTS, sourceLabels, type OutletRow, type Testimony } from '../format.js'
import * as docsCard from '../docs-card.js'
import { paintOutlets, paintOutletsError, paintOutletsLoading, paintStrip, paintTestimony, paintTestimonyError, paintTestimonyLoading } from '../render.js'
import { runFigure } from '../figure.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { person?: string; days?: string; source?: string }
// Distinct from an empty `people` array: an outage must never paint as "no one registered yet".
export type PeopleError = unknown

const $ = (id: string): any => document.getElementById(id)

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

  const controlValues = () => ({ days: $('testimonyDays').value, sort: 'count', limit: '18', source: $('testimonySource').value })

  // Width read fresh (never memoised), so any resize trigger paints at the current width.
  const repaint = () => {
    if (testimony) {
      paintTestimony({ data: testimony, domain: outlet })
      paintStrip({ data: testimony, domain: outlet, onPick: pickOutlet, width: $('strip').clientWidth || undefined })
    }
    if (outletRows) paintOutlets({ rows: outletRows, testimony, domain: outlet, onPick: pickOutlet })
  }

  const resetOutlet = () => {
    if (outlet === 'all') return
    outlet = 'all'
    repaint()
  }

  // Picking 'all' again routes through the runtime, so a card this figure does not own survives.
  const pickOutlet = (d: string) => {
    if (d === outlet) return
    if (d === 'all') {
      testimonyFigure.release()
      return
    }
    outlet = d
    repaint()
    showOutletDocs(d)
  }

  const showOutletDocs = (d: string) => {
    const personId = $('testimonyPerson').value
    if (!personId) return
    const person = people.find((p) => p.id === personId)
    const values = controlValues()
    docsCard.open({
      owner: 'testimony',
      kicker: 'Documentos de',
      title: d,
      sides: [{ personId, personName: person?.name ?? personId, query: api.docsParams({ days: values.days, source: values.source, domain: d }) }],
    })
  }

  const paintUnavailable = () => {
    testimony = null
    outletRows = null
    if (peopleError) {
      $('testimonyList').innerHTML =
        '<p class="note">Falha de rede ou base indisponível.<br>Nenhuma avaliação fictícia será exibida.<br><br><button class="quiet-button" id="testimonyRetry">Tentar novamente</button></p>'
      $('outletList').textContent = ''
      $('strip').hidden = true
      $('testimonyRetry')?.addEventListener('click', () => location.reload())
    } else {
      $('testimonyList').textContent = 'Nenhuma pessoa cadastrada.'
      $('outletList').textContent = ''
      $('strip').hidden = true
    }
  }

  // Only the testimony instance paints the unavailable state below, or the retry button
  // wires a second click listener when both instances load together.
  const outletsParams = (): URLSearchParams | null => {
    if (peopleError || !people.length) return null
    const qp = api.sourcesParams(controlValues())
    qp.set('person', $('testimonyPerson').value)
    return qp
  }

  const testimonyParamsFn = (): URLSearchParams | null => {
    if (peopleError || !people.length) {
      paintUnavailable()
      return null
    }
    const qp = api.testimonyParams(controlValues())
    qp.set('person', $('testimonyPerson').value)
    return qp
  }

  const asGraphOpts = (queryParams: URLSearchParams) => ({
    days: queryParams.get('days')!,
    sort: queryParams.get('sort')!,
    limit: queryParams.get('limit')!,
    source: queryParams.get('source')!,
  })

  const ghostOutlets = () => {
    if (outletRows) $('outletList').classList.add('is-loading')
    else paintOutletsLoading()
  }

  const paintOutletsData = (rows: OutletRow[]) => {
    outletRows = rows
    repaint()
  }

  const ghostTestimony = () => {
    if (testimony) {
      $('testimonyList').classList.add('is-loading')
      $('strip').classList.add('is-loading')
    } else paintTestimonyLoading()
  }

  const paintTestimonyData = (data: Testimony) => {
    testimony = data
    repaint()
  }

  const paintTestimonyErrorData = () => {
    testimony = null
    paintTestimonyError()
  }

  const outletsFigure = runFigure<OutletRow[]>({
    name: 'outlets',
    // The memo bucket is the route this hits (/sources), not the figure name, or a hit would
    // record `api:outlets` instead of `api:sources`.
    scope: 'sources',
    params: outletsParams,
    fetch: (queryParams, signal) => api.loadSources(queryParams.get('person')!, api.sourcesParams(asGraphOpts(queryParams)), signal),
    ghost: ghostOutlets,
    paint: paintOutletsData,
    paintError: paintOutletsError,
    detail: (rows, queryParams) => ({ person: queryParams.get('person'), rows: rows.length }),
  })

  const testimonyFigure = runFigure<Testimony>({
    name: 'testimony',
    params: testimonyParamsFn,
    fetch: (queryParams, signal) => api.loadTestimony(queryParams.get('person')!, api.testimonyParams(asGraphOpts(queryParams)), signal),
    ghost: ghostTestimony,
    paint: paintTestimonyData,
    paintError: paintTestimonyErrorData,
    detail: (_data, queryParams) => ({ person: queryParams.get('person') }),
    el: [$('strip'), $('testimonyList'), $('outletList')],
    markSelector: '[data-domain], [data-testimony-domain], [data-strip-domain]',
    onRelease: resetOutlet,
  })

  const load = () => {
    outlet = 'all'
    outletsFigure.load()
    testimonyFigure.load()
  }

  const onControlChange = () => {
    outlet = 'all'
    outletsFigure.reload()
    testimonyFigure.reload()
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
  // testimonyFigure's own runFigure already observes #strip (its el[0], issue #92 AC13).

  load()
}
