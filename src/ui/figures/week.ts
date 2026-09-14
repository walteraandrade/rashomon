// Figure 5. Side-effect free outside a browser. Never imports or is imported by the other four
// figures. Always requests days=7 (never exposed as a control); opens the shared docs card
// with one side — the tracked person, that column's calendar day and that word.

import * as api from '../api.js'
import { html, kinds, SOURCE_SEGMENTS, sourceLabels, type Week } from '../format.js'
import * as docsCard from '../docs-card.js'
import { createCanvasMeasure, paintWeek, paintWeekError, paintWeekLoading } from '../render.js'
import { span } from '../perf.js'
import { debounce, fromScope, readScope } from '../state.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { person?: string; source?: string; limit?: string }
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
  let data: Week | null = null
  let selected: { day: string; term: string; kind: string } | null = null
  let requestId = 0
  let controller: AbortController | null = null
  let metrics: ReturnType<typeof createCanvasMeasure> | null = null
  const measured = () => (metrics ??= createCanvasMeasure())

  const personId = () => $('weekPerson').value
  const source = () => $('weekSource').value
  const limit = () => $('weekLimit').value

  const repaint = () => {
    if (!data) return
    paintWeek({ data, metrics: measured(), selected, onPick: pick })
  }

  // Selecting is a toggle; the overflow list's own buttons carry the same data-day/term/kind.
  const pick = (day: string, term: string, kind: string) => {
    selected = selected && selected.day === day && selected.term === term && selected.kind === kind ? null : { day, term, kind }
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

  const showDocs = (word: { day: string; term: string; kind: string }) => {
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
          query: api.docsParams({ days: '7', source: source(), term: word.term, kind: word.kind, day: word.day }),
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
      $('weekChart').hidden = true
      $('weekChart').innerHTML = ''
      $('weekNote').textContent = 'Falha de rede ou base indisponível.'
      return
    }
    if (!people.length) {
      data = null
      $('weekChart').hidden = true
      $('weekChart').innerHTML = ''
      $('weekNote').textContent = 'Nenhuma pessoa cadastrada.'
      return
    }
    const params = api.weekParams({ source: source(), limit: limit() })
    const key = personId() + '?' + params
    if (!readScope('week', key)) {
      if (data) root.classList.add('is-loading')
      else paintWeekLoading()
    }
    const painted = span('figure:week')
    try {
      const result = await fromScope('week', key, () => api.loadWeek(personId(), params, (controller as AbortController).signal))
      if (id !== requestId) return
      data = result
      selected = null
      root.classList.remove('is-loading')
      repaint()
      painted({ person: personId(), query: key })
    } catch (e) {
      if (id === requestId && !aborted(e)) {
        data = null
        root.classList.remove('is-loading')
        paintWeekError()
      }
    }
  }

  const debouncedLoad = debounce(load)

  const onControlChange = () => {
    selected = null
    docsCard.close()
    debouncedLoad()
  }

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    if (docsCard.isOpen()) {
      docsCard.close()
      return
    }
    releaseSelection()
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
  $('weekChart').addEventListener('click', (e: MouseEvent) => background(e.target as Element | null))
  document.addEventListener('keydown', onKeydown)

  load()
}
