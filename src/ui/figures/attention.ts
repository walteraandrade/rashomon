// Figure 7 (issue #216). Side-effect free outside a browser. Never imports or is imported by
// atlas.ts, testimony.ts, compare.ts, rising.ts, week.ts or lenses.ts. Two independent fetches
// (attention/mentions) wired through figure.ts's runFigure, following testimony.ts's two-
// instance pattern: only the 'attention' instance owns el/markSelector/onRelease, so a day pick
// is owned by 'attention' in the docs card.

import * as api from '../api.js'
import { html, SOURCE_SEGMENTS, sourceLabels, type Attention } from '../format.js'
import * as docsCard from '../docs-card.js'
import { attentionDayLabel, createCanvasMeasure, paintAttention, paintAttentionError, paintAttentionLoading } from '../render.js'
import { runFigure } from '../figure.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { person?: string; source?: string }
// Distinct from an empty `people` array: an outage must never paint as "no one registered yet".
export type PeopleError = unknown

type TimelineBucket = { bucket_start: string; count: number }

// Tags a fetch with the recorte it was requested for, so a slow, stale response is dropped.
type Keyed<T> = { key: string; data: T }

const $ = (id: string): any => document.getElementById(id)

const OWNER = 'attention'

// The Wikimedia calendar day /attention's own `day` strings already speak in: the UTC date of
// a /timeline bucket's start, never the BRT date /week's own weekDayIso computes (spec §3.1).
const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10)

const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

const resolvePerson = (people: Person[], seeded: string | undefined) =>
  seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? '')

export const mount = (root: FigureRoot, { people, initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let mentionsBuckets: TimelineBucket[] | null = null
  let attentionSeries: { day: string; views: number }[] | null = null
  // Distinct from "never fetched yet": a real /attention failure states its own error note.
  let attentionErrored = false
  let selected: string | null = null
  let metrics: ReturnType<typeof createCanvasMeasure> | null = null
  const measured = () => (metrics ??= createCanvasMeasure())

  let chartWidth = 0
  // #attentionChart's content box, never #attention's (the section adds its own padding); unhidden first, since the boot ghost's first call still finds it hidden.
  const measureWidth = () => {
    const chart = $('attentionChart')
    if (chart?.hidden) chart.hidden = false
    const width = chart?.clientWidth
    if (width) chartWidth = width
    return chartWidth || undefined
  }

  const personId = () => $('attentionPerson').value
  const source = () => $('attentionSource').value

  const currentKey = () => `${personId()}|${source()}`

  // /attention has only `days`; the mentions series is the term-less /timeline, full kind set,
  // the figure's own source, fixed at days=30 (spec §2/§4) -- never exposed as a control.
  const mentionsQuery = () => new URLSearchParams({ term: '', kind: api.ATLAS_KINDS, days: '30', bucket: 'day', source: source() })

  const withoutPerson = (queryParams: URLSearchParams) => {
    const p = new URLSearchParams(queryParams)
    p.delete('person')
    return p
  }

  const repaint = () => {
    if (!mentionsBuckets) return
    const mentions = mentionsBuckets.map((b) => ({ day: utcDay(b.bucket_start), count: b.count }))
    // /attention never zero-fills; a day present in the mentions axis but absent from `series`
    // (no wikipedia alias, or not yet backfilled) is padded to zero here (spec §3.3).
    const viewsByDay = new Map((attentionSeries ?? []).map((s) => [s.day, s.views]))
    const views = mentions.map((m) => ({ day: m.day, views: viewsByDay.get(m.day) ?? 0 }))
    paintAttention({
      mentions,
      views,
      metrics: measured(),
      selected,
      onPick: pick,
      width: measureWidth(),
      viewsLoading: !attentionErrored && attentionSeries === null,
      viewsError: attentionErrored,
    })
  }

  const pick = (day: string) => {
    if (selected === day) {
      figure.release()
      return
    }
    selected = day
    repaint()
    showDocs(day)
  }

  const releaseSelection = () => {
    if (!selected) return
    selected = null
    repaint()
  }

  const showDocs = (day: string) => {
    const id = personId()
    const person = people.find((p) => p.id === id)
    docsCard.open({
      owner: OWNER,
      kicker: `Documentos de ${attentionDayLabel(day)}`,
      title: day,
      sides: [
        {
          personId: id,
          personName: person?.name ?? id,
          query: api.docsParams({ days: '30', source: source(), term: '', kind: api.ATLAS_KINDS, day }),
        },
      ],
    })
  }

  const paintUnavailable = () => {
    mentionsBuckets = null
    attentionSeries = null
    attentionErrored = false
    $('attentionChart').hidden = true
    $('attentionChart').innerHTML = ''
    $('attentionNote').textContent = peopleError ? 'Falha de rede ou base indisponível.' : 'Nenhuma pessoa cadastrada.'
  }

  const attentionParams = (): URLSearchParams | null => {
    if (peopleError || !people.length) {
      paintUnavailable()
      return null
    }
    const qp = api.attentionParams({})
    qp.set('person', personId())
    return qp
  }

  const mentionsParams = (): URLSearchParams | null => {
    if (peopleError || !people.length) return null
    const qp = mentionsQuery()
    qp.set('person', personId())
    return qp
  }

  const ghost = () => {
    if (mentionsBuckets) root.classList.add('is-loading')
    else paintAttentionLoading(measureWidth())
  }

  const paintMentions = ({ key, data: buckets }: Keyed<TimelineBucket[]>) => {
    if (key !== currentKey()) return
    mentionsBuckets = buckets
    root.classList.remove('is-loading')
    repaint()
  }

  const paintMentionsError = () => {
    mentionsBuckets = null
    root.classList.remove('is-loading')
    paintAttentionError()
  }

  const paintAttentionData = ({ key, data }: Keyed<Attention>) => {
    if (key !== currentKey()) return
    attentionSeries = data.series
    attentionErrored = false
    root.classList.remove('is-loading')
    repaint()
  }

  const paintAttentionErrorData = () => {
    attentionSeries = null
    attentionErrored = true
    root.classList.remove('is-loading')
    repaint()
  }

  // Only the 'attention' instance owns el/markSelector/onRelease (testimony.ts's precedent):
  // the docs card this figure opens is owned by 'attention' (AC8), so figure.release()'s own
  // openedBy(name) check only matches when this instance's name is that same string.
  const figure = runFigure<Keyed<Attention>>({
    name: 'attention',
    params: attentionParams,
    fetch: (queryParams, signal) => {
      const key = currentKey()
      return api.loadAttention(queryParams.get('person')!, withoutPerson(queryParams), signal).then((data) => ({ key, data }))
    },
    ghost,
    paint: paintAttentionData,
    paintError: paintAttentionErrorData,
    detail: (_data, queryParams) => ({ person: queryParams.get('person') }),
    el: $('attentionChart'),
    markSelector: '[data-day]',
    onRelease: releaseSelection,
  })

  const mentionsFigure = runFigure<Keyed<TimelineBucket[]>>({
    name: 'mentions',
    params: mentionsParams,
    fetch: (queryParams, signal) => {
      const key = currentKey()
      return api.loadTimeline(queryParams.get('person')!, withoutPerson(queryParams), signal).then((data) => ({ key, data }))
    },
    ghost,
    paint: paintMentions,
    paintError: paintMentionsError,
    detail: (_data, queryParams) => ({ person: queryParams.get('person') }),
  })

  // A fresh recorte must never paint one series against the other's stale, previous-person
  // data while the two independent fetches race.
  const reset = () => {
    mentionsBuckets = null
    attentionSeries = null
    attentionErrored = false
  }

  const load = () => {
    reset()
    selected = null
    figure.load()
    mentionsFigure.load()
  }

  // week.ts/compare.ts's same move: release before reload, so a control change never leaves
  // another recorte's docs card open.
  const onControlChange = () => {
    figure.release()
    reset()
    figure.reload()
    mentionsFigure.reload()
  }

  $('attentionSource').innerHTML = html`${SOURCE_SEGMENTS.map(([value, text]) => html`<option value="${value}">${sourceLabels[value] ?? text}</option>`)}`
  $('attentionPerson').innerHTML = ''
  for (const p of people) $('attentionPerson').add(new Option(p.name, p.id))
  $('attentionPerson').value = resolvePerson(people, initial.person)
  applySeed($('attentionSource'), initial.source)

  $('attentionPerson').addEventListener('change', onControlChange)
  $('attentionSource').addEventListener('change', onControlChange)

  load()
}
