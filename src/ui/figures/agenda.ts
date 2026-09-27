// Figure 8 (issue #208). Side-effect free outside a browser. Spans every tracked person at
// once, so — unlike every other figure — it takes no person <select> of its own: the route's
// own `persons` list is what feeds the grid's columns.

import * as api from '../api.js'
import { html, SOURCE_SEGMENTS, sourceLabels, type Agenda } from '../format.js'
import * as docsCard from '../docs-card.js'
import { paintAgenda, paintAgendaError, paintAgendaLoading, type AgendaSelection } from '../render.js'
import { runFigure } from '../figure.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { days?: string; source?: string }
// Distinct from a genuinely empty grid: an outage must never paint as "no domain cleared the floor".
export type PeopleError = unknown

const $ = (id: string): any => document.getElementById(id)

const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

export const mount = (root: FigureRoot, { initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let data: Agenda | null = null
  let selected: AgendaSelection = null

  const days = () => $('agendaDays').value
  const source = () => $('agendaSource').value

  const repaint = () => {
    if (!data) return
    paintAgenda({ data, min: api.AGENDA_MIN, selected, onPick: pick })
  }

  // Selecting a cell is a toggle, exactly like every other figure's own pick.
  const pick = (personId: string, personName: string, domain: string) => {
    if (selected && selected.personId === personId && selected.domain === domain) {
      figure.release()
      return
    }
    selected = { personId, domain }
    repaint()
    showDocs(personId, personName, domain)
  }

  const releaseSelection = () => {
    if (!selected) return
    selected = null
    repaint()
  }

  // One side only: a cell belongs to one person on one outlet, never two at once. `data.days`
  // is the window the grid was actually built with, so a click on a stale grid still asks for
  // the window it shows rather than whatever the days select has moved to since; `source` is
  // not on the payload, so it still reads the control at click time.
  const showDocs = (personId: string, personName: string, domain: string) => {
    if (!data) return
    docsCard.open({
      owner: 'agenda',
      kicker: 'Documentos de',
      title: domain,
      sides: [{ personId, personName, query: api.docsParams({ days: String(data.days), source: source(), domain }) }],
    })
  }

  const paintUnavailable = () => {
    data = null
    const grid = $('agendaGrid')
    if (!grid) return
    grid.hidden = false
    grid.innerHTML = '<p class="note">Falha de rede ou base indisponível.<br><br><button class="quiet-button" id="agendaRetry">Tentar novamente</button></p>'
    $('agendaRetry')?.addEventListener('click', () => location.reload())
  }

  const params = (): URLSearchParams | null => {
    if (peopleError) {
      paintUnavailable()
      return null
    }
    return api.agendaParams({ days: days(), source: source() })
  }

  const ghost = () => {
    if (data) root.classList.add('is-loading')
    else paintAgendaLoading()
  }

  const dropStalePick = () => {
    if (docsCard.openedBy('agenda')) docsCard.close()
    selected = null
  }

  const paint = (result: Agenda) => {
    // A resize repaint calls this with the same object again; only a new dataset clears the
    // pick and closes a card opened on the previous recorte during the reload debounce.
    const isNewData = result !== data
    data = result
    if (isNewData) dropStalePick()
    root.classList.remove('is-loading')
    repaint()
  }

  const paintErrorData = () => {
    data = null
    dropStalePick()
    root.classList.remove('is-loading')
    paintAgendaError(() => figure.reload())
  }

  const figure = runFigure<Agenda>({
    name: 'agenda',
    params,
    fetch: (queryParams, signal) => api.loadAgenda(queryParams, signal),
    ghost,
    paint,
    paintError: paintErrorData,
    detail: (result) => ({ domains: result.domains.length }),
    el: $('agendaGrid'),
    markSelector: '[data-person]',
    onRelease: releaseSelection,
  })

  const onControlChange = () => {
    figure.release()
    figure.reload()
  }

  $('agendaSource').innerHTML = html`${SOURCE_SEGMENTS.map(([value, text]) => html`<option value="${value}">${sourceLabels[value] ?? text}</option>`)}`
  applySeed($('agendaSource'), initial.source)
  applySeed($('agendaDays'), initial.days)

  $('agendaDays').addEventListener('change', onControlChange)
  $('agendaSource').addEventListener('change', onControlChange)

  figure.load()
}
