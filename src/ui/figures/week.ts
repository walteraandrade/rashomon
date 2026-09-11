// Figure 4. Side-effect free outside a browser. Never imports or is imported by the other
// figures. Opens the shared docs card for one person + one term + one calendar day.

import * as api from '../api.js'
import { html, kinds, SOURCE_SEGMENTS, sourceLabels, type Week } from '../format.js'
import * as docsCard from '../docs-card.js'
import { createCanvasMeasure, paintWeek, paintWeekError, paintWeekLoading } from '../render.js'
import { debounce, fromScope, readScope } from '../state.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { person?: string; source?: string; limit?: string }
export type PeopleError = unknown

const $ = (id: string): any => document.getElementById(id)

const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError'

const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

const resolvePerson = (people: Person[], seeded: string | undefined) =>
  seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? '')

export const docsQuery = (source: string, word: { term: string; kind: string }, day: string) =>
  api.docsParams({ days: '7', source, term: word.term, kind: word.kind, day })

export const mount = (root: FigureRoot, { people, initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let data: Week | null = null
  let selected: { term: string; kind: string; day: string } | null = null
  let lastWidth = 0
  let requestId = 0
  let controller: AbortController | null = null
  let metrics = null as ReturnType<typeof createCanvasMeasure> | null
  const measured = () => (metrics ??= createCanvasMeasure())

  const controlValues = () => ({
    person: $('weekPerson').value,
    source: $('weekSource').value,
    limit: $('weekLimit').value,
  })

  const repaint = () => {
    if (!data) return
    paintWeek({ data, metrics: measured(), selected, onPick: pick, width: lastWidth || undefined })
  }

  const pick = (term: string, kind: string, day: string) => {
    selected = selected && selected.term === term && selected.kind === kind && selected.day === day ? null : { term, kind, day }
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

  const showDocs = (word: { term: string; kind: string; day: string }) => {
    const personId = $('weekPerson').value
    const personName = people.find((p) => p.id === personId)?.name ?? personId
    docsCard.open({
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'}`,
      title: word.term,
      sides: [
        {
          personId,
          personName,
          query: docsQuery($('weekSource').value, word, word.day),
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
      $('weekChart').hidden = false
      $('weekChart').innerHTML =
        '<span class="empty-hint">Falha de rede ou base indisponível. <button class="quiet-button" id="weekRetry">Tentar novamente</button></span>'
      $('weekRetry')?.addEventListener('click', () => location.reload())
      return
    }
    if (!people.length) {
      data = null
      $('weekChart').hidden = false
      $('weekChart').innerHTML = '<span class="empty-hint">Nenhuma pessoa cadastrada.</span>'
      return
    }
    const values = controlValues()
    const params = api.weekParams({ source: values.source, limit: values.limit })
    const key = values.person + '?' + params
    if (!readScope('week', key)) {
      if (data) root.classList.add('is-loading')
      else paintWeekLoading()
    }
    try {
      const result = await fromScope('week', key, () => api.loadWeek(values.person, params, (controller as AbortController).signal))
      if (id !== requestId) return
      data = result
      selected = null
      lastWidth = $('weekChart').clientWidth || 0
      root.classList.remove('is-loading')
      repaint()
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

  $('weekSource').innerHTML = html`${SOURCE_SEGMENTS.map(([value, text]) => html`<option value="${value}">${sourceLabels[value] ?? text}</option>`)}`
  $('weekPerson').innerHTML = ''
  for (const p of people) $('weekPerson').add(new Option(p.name, p.id))
  $('weekPerson').value = resolvePerson(people, initial.person)
  applySeed($('weekSource'), initial.source)
  applySeed($('weekLimit'), initial.limit)

  for (const id of ['weekPerson', 'weekSource', 'weekLimit']) $(id).addEventListener('change', onControlChange)
  $('weekChart').addEventListener('click', (e: MouseEvent) => background(e.target as Element | null))
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') releaseSelection()
  })
  new ResizeObserver(() => {
    const width = $('weekChart').clientWidth
    if (data && width && width !== lastWidth) {
      lastWidth = width
      repaint()
    }
  }).observe($('weekChart'))

  load()
}
