// Figure 4. Side-effect free outside a browser. Never imports or is imported by the other three
// figures. Opens the shared docs card with one side — the tracked person — scoped to the recent
// 7-day window only, never the 30-day baseline, since a rising word belongs to one person.

import * as api from '../api.js'
import { fmt, html, kinds, SOURCE_SEGMENTS, sourceLabels, type Measure, type Rising } from '../format.js'
import * as docsCard from '../docs-card.js'
import { createCanvasMeasure, paintRisingLoading, paintRisingRuler, paintRisingRulerError } from '../render.js'
import { span } from '../perf.js'
import { debounce, fromScope, readScope } from '../state.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { person?: string; source?: string }
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

// "keeps the absolute story visible" per the issue: the ruler's own axis is relative, so the
// two window totals are printed as plain text next to it.
const aboutLine = (about: { recent: number; baseline: number }) =>
  `A pessoa: ${fmt(about.recent)} ${about.recent === 1 ? 'texto' : 'textos'} nos últimos 7 dias, ${fmt(about.baseline)} nos 30 dias antes.`

export const mount = (root: FigureRoot, { people, initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let data: Rising | null = null
  let selected: { term: string; kind: string } | null = null
  let lastWidth = 0
  let requestId = 0
  let controller: AbortController | null = null
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
    selected = selected && selected.term === term && selected.kind === kind ? null : { term, kind }
    repaint()
    if (selected) showDocs(selected)
    else docsCard.close()
  }

  const releaseSelection = () => {
    if (!selected) return
    selected = null
    repaint()
    docsCard.close()
  }

  // Always the last 7 days, never the figure's own 30-day baseline: a rising word's story is
  // "what does this look like now", not the window it was compared against.
  const showDocs = (word: { term: string; kind: string }) => {
    const id = personId()
    const person = people.find((p) => p.id === id)
    docsCard.open({
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

  const background = (target: Element | null) => {
    if (target && target.closest('[data-term]')) return
    releaseSelection()
  }

  const load = async () => {
    const id = ++requestId
    controller?.abort()
    controller = new AbortController()
    if (peopleError) {
      data = null
      $('risingRuler').hidden = true
      $('risingRuler').innerHTML = ''
      $('risingAbout').textContent = 'Falha de rede ou base indisponível.'
      return
    }
    if (!people.length) {
      data = null
      $('risingRuler').hidden = true
      $('risingRuler').innerHTML = ''
      $('risingAbout').textContent = 'Nenhuma pessoa cadastrada.'
      return
    }
    const params = api.risingParams({ source: source() })
    const key = personId() + '?' + params
    if (!readScope('rising', key)) {
      if (data) root.classList.add('is-loading')
      else paintRisingLoading()
    }
    const painted = span('figure:rising')
    try {
      const result = await fromScope('rising', key, () => api.loadRising(personId(), params, (controller as AbortController).signal))
      if (id !== requestId) return
      data = result
      selected = null
      lastWidth = $('risingRuler').clientWidth || 0
      root.classList.remove('is-loading')
      repaint()
      painted({ person: personId(), query: key })
    } catch (e) {
      if (id === requestId && !aborted(e)) {
        data = null
        root.classList.remove('is-loading')
        paintRisingRulerError()
        $('risingAbout').textContent = ''
      }
    }
  }

  const debouncedLoad = debounce(load)

  const onControlChange = () => {
    selected = null
    debouncedLoad()
  }

  $('risingSource').innerHTML = html`${SOURCE_SEGMENTS.map(([value, text]) => html`<option value="${value}">${sourceLabels[value] ?? text}</option>`)}`
  $('risingPerson').innerHTML = ''
  for (const p of people) $('risingPerson').add(new Option(p.name, p.id))
  $('risingPerson').value = resolvePerson(people, initial.person)
  applySeed($('risingSource'), initial.source)

  $('risingPerson').addEventListener('change', onControlChange)
  $('risingSource').addEventListener('change', onControlChange)
  $('risingRuler').addEventListener('click', (e: MouseEvent) => background(e.target as Element | null))
  new ResizeObserver(() => {
    const width = $('risingRuler').clientWidth
    if (data && data.terms.length && width && width !== lastWidth) {
      lastWidth = width
      repaint()
    }
  }).observe($('risingRuler'))

  load()
}
