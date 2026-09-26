// Figure 4. Side-effect free outside a browser. Never imports or is imported by the other three
// figures. Opens the shared docs card with one side — the tracked person — scoped to the recent
// 7-day window only, never the 30-day baseline, since a rising word belongs to one person.

import * as api from '../api.js'
import { fmt, html, kinds, SOURCE_SEGMENTS, sourceLabels, type Measure, type Rising, type RisingAbout } from '../format.js'
import * as docsCard from '../docs-card.js'
import { createCanvasMeasure, paintRisingLoading, paintRisingRuler, paintRisingRulerError } from '../render.js'
import { runFigure } from '../figure.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { person?: string; source?: string }
// Distinct from an empty `people` array: an outage must never paint as "no one registered yet".
export type PeopleError = unknown

const $ = (id: string): any => document.getElementById(id)

const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

const resolvePerson = (people: Person[], seeded: string | undefined) =>
  seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? '')

// "keeps the absolute story visible" per the issue: the ruler's own axis is relative, so the
// two window totals are printed as plain text next to it.
// words_* are doc_terms rows (text-word pairs), not words, and a payload from before they
// existed simply says nothing about them rather than printing a zero.
const aboutLine = (about: RisingAbout) => {
  const docs = `A pessoa: ${fmt(about.recent)} ${about.recent === 1 ? 'texto' : 'textos'} nos últimos 7 dias, ${fmt(about.baseline)} nos 30 dias antes`
  const pairs = Number.isFinite(about.words_recent) && Number.isFinite(about.words_baseline) ? `; ${fmt(about.words_recent)} ${about.words_recent === 1 ? 'par texto-palavra' : 'pares texto-palavra'} agora, ${fmt(about.words_baseline)} antes.` : '.'
  return docs + pairs
}

export const mount = (root: FigureRoot, { people, initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let data: Rising | null = null
  let selected: { term: string; kind: string } | null = null
  let lastWidth = 0
  let metrics: Measure | null = null
  const measured = () => (metrics ??= createCanvasMeasure())

  const personId = () => $('risingPerson').value
  const source = () => $('risingSource').value

  const repaint = () => {
    if (!data) return
    paintRisingRuler({ data, metrics: measured(), selected, onPick: pick, width: lastWidth || undefined })
    $('risingAbout').textContent = aboutLine(data.about)
  }

  // Selecting is a toggle; the ruler's own overflow buttons carry the same data-term/data-kind.
  const pick = (term: string, kind: string) => {
    if (selected && selected.term === term && selected.kind === kind) {
      figure.release()
      return
    }
    selected = { term, kind }
    repaint()
    showDocs(selected)
  }

  const releaseSelection = () => {
    if (!selected) return
    selected = null
    repaint()
  }

  // Always the last 7 days, never the figure's own 30-day baseline: a rising word's story is
  // "what does this look like now", not the window it was compared against.
  const showDocs = (word: { term: string; kind: string }) => {
    const id = personId()
    const person = people.find((p) => p.id === id)
    docsCard.open({
      owner: 'rising',
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'}`,
      title: word.term,
      sides: [
        {
          personId: id,
          personName: person?.name ?? id,
          label: person?.name ?? id,
          query: api.docsParams({ days: '7', source: source(), term: word.term, kind: word.kind }),
        },
      ],
    })
  }

  const params = (): URLSearchParams | null => {
    if (peopleError) {
      data = null
      $('risingRuler').hidden = true
      $('risingRuler').innerHTML = ''
      $('risingAbout').textContent = 'Falha de rede ou base indisponível.'
      return null
    }
    if (!people.length) {
      data = null
      $('risingRuler').hidden = true
      $('risingRuler').innerHTML = ''
      $('risingAbout').textContent = 'Nenhuma pessoa cadastrada.'
      return null
    }
    const qp = api.risingParams({ source: source() })
    qp.set('person', personId())
    return qp
  }

  const ghost = () => {
    if (data) root.classList.add('is-loading')
    else paintRisingLoading()
  }

  const paint = (result: Rising) => {
    // A resize repaint calls this with the same object again; only a new dataset clears the pick.
    const isNewData = result !== data
    data = result
    if (isNewData) selected = null
    lastWidth = $('risingRuler').clientWidth || 0
    root.classList.remove('is-loading')
    repaint()
  }

  const paintError = () => {
    data = null
    root.classList.remove('is-loading')
    paintRisingRulerError()
    $('risingAbout').textContent = ''
  }

  const figure = runFigure<Rising>({
    name: 'rising',
    params,
    fetch: (queryParams, signal) => api.loadRising(queryParams.get('person')!, api.risingParams({ source: queryParams.get('source')! }), signal),
    ghost,
    paint,
    paintError,
    detail: (_data, queryParams) => ({ person: queryParams.get('person') }),
    el: $('risingRuler'),
    markSelector: '[data-term]',
    onRelease: releaseSelection,
  })

  const onControlChange = () => {
    figure.release()
    figure.reload()
  }

  $('risingSource').innerHTML = html`${SOURCE_SEGMENTS.map(([value, text]) => html`<option value="${value}">${sourceLabels[value] ?? text}</option>`)}`
  $('risingPerson').innerHTML = ''
  for (const p of people) $('risingPerson').add(new Option(p.name, p.id))
  $('risingPerson').value = resolvePerson(people, initial.person)
  applySeed($('risingSource'), initial.source)

  $('risingPerson').addEventListener('change', onControlChange)
  $('risingSource').addEventListener('change', onControlChange)

  figure.load()
}
