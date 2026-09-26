// Figure 7 (#207). Spans every tracked person at once, no `person` control. Opens the shared
// docs card with one side: the row person's own docs, filtered to the column person via `with=`.

import * as api from '../api.js'
import { html, sourceLabels, SOURCE_SEGMENTS, type Comention } from '../format.js'
import * as docsCard from '../docs-card.js'
import { paintComention, paintComentionError, paintComentionLoading, type ComentionSelection } from '../render.js'
import { runFigure } from '../figure.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }
export type Person = { id: string; name: string }
export type Seed = { days?: string; source?: string; lean?: string; min?: string }
export type PeopleError = unknown

const $ = (id: string): any => document.getElementById(id)

const OWNER = 'comention'
const DEFAULT_WIDTH = 860

const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

export const mount = (root: FigureRoot, { people, initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let data: Comention | null = null
  let selected: ComentionSelection = null
  let width = DEFAULT_WIDTH

  const days = () => $('comentionDays').value
  const source = () => $('comentionSource').value
  const lean = () => $('comentionLean').value
  const min = () => $('comentionMin').value

  const measureWidth = () => {
    const w = $('comentionMatrix')?.clientWidth
    return w ? Math.floor(w) : width
  }

  const repaint = () => {
    if (!data) return
    width = measureWidth()
    paintComention({ data, width, selected, onPick: pick })
  }

  const pick = (a: string, b: string) => {
    if (selected && selected.a === a && selected.b === b) {
      figure.release()
      return
    }
    selected = { a, b }
    repaint()
    showDocs(a, b)
  }

  const releaseSelection = () => {
    if (!selected) return
    selected = null
    repaint()
  }

  const showDocs = (a: string, b: string) => {
    const personA = people.find((p) => p.id === a)
    const personB = people.find((p) => p.id === b)
    docsCard.open({
      owner: OWNER,
      kicker: 'Documentos com as duas pessoas',
      title: `${personA?.name ?? a} e ${personB?.name ?? b}`,
      sides: [
        {
          personId: a,
          personName: personA?.name ?? a,
          label: personA?.name ?? a,
          query: api.docsParams({ days: days(), source: source(), lean: lean(), withId: b }),
        },
      ],
    })
  }

  const params = (): URLSearchParams | null => {
    if (peopleError) {
      data = null
      $('comentionMatrix').hidden = true
      $('comentionMatrix').innerHTML = ''
      $('comentionAbout').textContent = 'Falha de rede ou base indisponível.'
      return null
    }
    return api.comentionParams({ days: days(), source: source(), lean: lean(), min: min() })
  }

  const ghost = () => {
    if (data) root.classList.add('is-loading')
    else paintComentionLoading()
  }

  const paint = (result: Comention) => {
    const isNewData = result !== data
    data = result
    if (isNewData) selected = null
    root.classList.remove('is-loading')
    repaint()
  }

  const paintError = () => {
    data = null
    root.classList.remove('is-loading')
    paintComentionError()
  }

  const figure = runFigure<Comention>({
    name: 'comention',
    params,
    fetch: (queryParams, signal) => api.loadComention(queryParams, signal),
    ghost,
    paint,
    paintError,
    el: $('comentionMatrix'),
    markSelector: '[data-a]',
    onRelease: releaseSelection,
  })

  const onControlChange = () => {
    figure.release()
    figure.reload()
  }

  $('comentionSource').innerHTML = html`${SOURCE_SEGMENTS.map(([value, text]) => html`<option value="${value}">${sourceLabels[value] ?? text}</option>`)}`
  applySeed($('comentionDays'), initial.days)
  applySeed($('comentionSource'), initial.source)
  applySeed($('comentionLean'), initial.lean)
  applySeed($('comentionMin'), initial.min)

  $('comentionDays').addEventListener('change', onControlChange)
  $('comentionSource').addEventListener('change', onControlChange)
  $('comentionLean').addEventListener('change', onControlChange)
  $('comentionMin').addEventListener('change', onControlChange)

  figure.load()
}
