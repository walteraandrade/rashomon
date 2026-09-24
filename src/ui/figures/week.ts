// Figure 5. Side-effect free outside a browser. Never imports or is imported by the other four
// figures. Always requests days=7 (never exposed as a control); opens the shared docs card
// with one side — the tracked person, that column's calendar day and that word.

import * as api from '../api.js'
import { html, kinds, SOURCE_SEGMENTS, sourceLabels, weekDayIso, weekDayLabel, type Week } from '../format.js'
import * as docsCard from '../docs-card.js'
import { createCanvasMeasure, paintWeek, paintWeekError, paintWeekLoading } from '../render.js'
import { WEEK_COLUMN_WIDTH } from '../layout.js'
import { runFigure } from '../figure.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { person?: string; source?: string; limit?: string }
// Distinct from an empty `people` array: an outage must never paint as "no one registered yet".
export type PeopleError = unknown

const $ = (id: string): any => document.getElementById(id)

const OWNER = 'week'

const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

const resolvePerson = (people: Person[], seeded: string | undefined) =>
  seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? '')

export const mount = (root: FigureRoot, { people, initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let data: Week | null = null
  let selected: { day: string; term: string; kind: string } | null = null
  let metrics: ReturnType<typeof createCanvasMeasure> | null = null
  let columnWidth = WEEK_COLUMN_WIDTH
  const measured = () => (metrics ??= createCanvasMeasure())

  // The svg is drawn at the column's real width so type is never scaled: a 12px word is 12px
  // at 1280px and at 390px (where atlas.css stacks the days). The grid decides the width, not
  // the content (minmax(0, 1fr)), so one .week-day is the measure.
  const measureColumn = () => {
    const day = $('weekChart')?.querySelector?.('.week-day')
    const width = day?.clientWidth
    return width ? Math.floor(width) : columnWidth
  }

  const personId = () => $('weekPerson').value
  const source = () => $('weekSource').value
  const limit = () => $('weekLimit').value

  const repaint = () => {
    if (!data) return
    paintWeek({ data, metrics: measured(), selected, onPick: pick, width: columnWidth })
    const width = measureColumn()
    if (width !== columnWidth) {
      columnWidth = width
      paintWeek({ data, metrics: measured(), selected, onPick: pick, width: columnWidth })
    }
  }

  // Selecting is a toggle; the overflow list's own buttons carry the same data-day/term/kind.
  const pick = (day: string, term: string, kind: string) => {
    if (selected && selected.day === day && selected.term === term && selected.kind === kind) {
      figure.release()
      return
    }
    selected = { day, term, kind }
    repaint()
    showDocs(selected)
  }

  const releaseSelection = () => {
    if (!selected) return
    selected = null
    repaint()
  }

  const showDocs = (word: { day: string; term: string; kind: string }) => {
    const id = personId()
    const person = people.find((p) => p.id === id)
    const bucket = data?.buckets.find((b) => weekDayIso(b.start) === word.day)
    // The card names the day, or its count contradicts the atlas for no visible reason.
    const day = bucket ? weekDayLabel(bucket.start) : word.day
    docsCard.open({
      owner: OWNER,
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'} · ${day}`,
      title: word.term,
      sides: [
        {
          personId: id,
          personName: person?.name ?? id,
          label: person?.name ?? id,
          query: api.docsParams({ days: '7', source: source(), term: word.term, kind: word.kind, day: word.day }),
        },
      ],
    })
  }

  const params = (): URLSearchParams | null => {
    if (peopleError) {
      data = null
      $('weekChart').hidden = true
      $('weekChart').innerHTML = ''
      $('weekNote').textContent = 'Falha de rede ou base indisponível.'
      return null
    }
    if (!people.length) {
      data = null
      $('weekChart').hidden = true
      $('weekChart').innerHTML = ''
      $('weekNote').textContent = 'Nenhuma pessoa cadastrada.'
      return null
    }
    const qp = api.weekParams({ source: source(), limit: limit() })
    qp.set('person', personId())
    return qp
  }

  const ghost = () => {
    if (data) root.classList.add('is-loading')
    else paintWeekLoading()
  }

  const paint = (result: Week) => {
    // A resize repaint (figure.ts, since `el` is given) calls this with the same object again;
    // only a genuinely new dataset clears the pick.
    const isNewData = result !== data
    data = result
    if (isNewData) selected = null
    root.classList.remove('is-loading')
    repaint()
  }

  const paintError = () => {
    data = null
    root.classList.remove('is-loading')
    paintWeekError()
  }

  // `el`/`markSelector` give the background-click and Escape wiring; the remeasuring
  // ResizeObserver below stays this figure's own (it repaints twice, figure.ts's does not).
  const figure = runFigure<Week>({
    name: 'week',
    params,
    fetch: (queryParams, signal) => api.loadWeek(queryParams.get('person')!, api.weekParams({ source: queryParams.get('source')!, limit: queryParams.get('limit')! }), signal),
    ghost,
    paint,
    paintError,
    detail: (_data, queryParams) => ({ person: queryParams.get('person') }),
    el: $('weekChart'),
    markSelector: '[data-term]',
    onRelease: releaseSelection,
  })

  // Closes the card only when this figure opened it: a control here must not shut a card the
  // atlas or the ruler is showing (#148 review, 2).
  const onControlChange = () => {
    figure.release()
    figure.reload()
  }

  $('weekSource').innerHTML = html`${SOURCE_SEGMENTS.map(([value, text]) => html`<option value="${value}">${sourceLabels[value] ?? text}</option>`)}`
  $('weekPerson').innerHTML = ''
  for (const p of people) $('weekPerson').add(new Option(p.name, p.id))
  $('weekPerson').value = resolvePerson(people, initial.person)
  applySeed($('weekSource'), initial.source)
  applySeed($('weekLimit'), initial.limit)

  $('weekPerson').addEventListener('change', onControlChange)
  $('weekSource').addEventListener('change', onControlChange)
  $('weekLimit').addEventListener('change', onControlChange)
  if (typeof ResizeObserver !== 'undefined')
    new ResizeObserver(() => {
      if (data && measureColumn() !== columnWidth) repaint()
    }).observe($('weekChart'))

  figure.load()
}
