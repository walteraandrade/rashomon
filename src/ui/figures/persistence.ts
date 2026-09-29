// Figure 10 (issue #215). Side-effect free outside a browser. Never imports or is imported by
// another figure. Opens the shared docs card with one side: the tracked person, one week's
// Monday-to-Sunday span and that word.

import * as api from '../api.js'
import * as docsCard from '../docs-card.js'
import { runFigure } from '../figure.js'
import { kinds, weekSpanLabel, type Persistence } from '../format.js'
import { paintPersistence, paintPersistenceError, paintPersistenceLoading } from '../render.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { person?: string; weeks?: string; limit?: string }
export type PeopleError = unknown

const $ = (id: string): any => document.getElementById(id)

const OWNER = 'persistence'

const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

const resolvePerson = (people: Person[], seeded: string | undefined) =>
  seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? '')

export const mount = (root: FigureRoot, { people, initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let data: Persistence | null = null
  let selected: { week: string; term: string; kind: string } | null = null

  const personId = () => $('persistencePerson').value
  const weeks = () => $('persistenceWeeks').value
  const limit = () => $('persistenceLimit').value

  const repaint = () => {
    if (data) paintPersistence({ data, selected, onPick: pick })
  }

  const pick = (week: string, term: string, kind: string) => {
    if (selected && selected.week === week && selected.term === term && selected.kind === kind) {
      figure.release()
      return
    }
    selected = { week, term, kind }
    repaint()
    showDocs(selected)
  }

  const releaseSelection = () => {
    if (!selected) return
    selected = null
    repaint()
  }

  const showDocs = (word: { week: string; term: string; kind: string }) => {
    const id = personId()
    const person = people.find((p) => p.id === id)
    docsCard.open({
      owner: OWNER,
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'} · ${weekSpanLabel(word.week)}`,
      title: word.term,
      sides: [
        {
          personId: id,
          personName: person?.name ?? id,
          label: person?.name ?? id,
          query: api.docsParams({ days: String(data?.horizon ?? ''), source: 'all', term: word.term, kind: word.kind, week: word.week }),
        },
      ],
    })
  }

  const params = (): URLSearchParams | null => {
    const failure = peopleError ? 'Falha de rede ou base indisponível.' : !people.length ? 'Nenhuma pessoa cadastrada.' : ''
    if (failure) {
      data = null
      $('persistenceChart').hidden = true
      $('persistenceChart').innerHTML = ''
      $('persistenceNote').textContent = failure
      return null
    }
    const qp = api.persistenceParams({ weeks: weeks(), limit: limit() })
    qp.set('person', personId())
    return qp
  }

  const ghost = () => {
    if (data) root.classList.add('is-loading')
    else paintPersistenceLoading()
  }

  const paint = (result: Persistence) => {
    const isNewData = result !== data
    data = result
    if (isNewData) selected = null
    root.classList.remove('is-loading')
    repaint()
  }

  const paintError = () => {
    data = null
    root.classList.remove('is-loading')
    paintPersistenceError()
  }

  const figure = runFigure<Persistence>({
    name: 'persistence',
    params,
    fetch: (queryParams, signal) => api.loadPersistence(queryParams.get('person')!, api.persistenceParams({ weeks: queryParams.get('weeks')!, limit: queryParams.get('limit')! }), signal),
    ghost,
    paint,
    paintError,
    detail: (_data, queryParams) => ({ person: queryParams.get('person') }),
    el: $('persistenceChart'),
    markSelector: '[data-week]',
    onRelease: releaseSelection,
  })

  const onControlChange = () => {
    figure.release()
    figure.reload()
  }

  $('persistencePerson').innerHTML = ''
  for (const p of people) $('persistencePerson').add(new Option(p.name, p.id))
  $('persistencePerson').value = resolvePerson(people, initial.person)
  applySeed($('persistenceWeeks'), initial.weeks)
  applySeed($('persistenceLimit'), initial.limit)

  $('persistencePerson').addEventListener('change', onControlChange)
  $('persistenceWeeks').addEventListener('change', onControlChange)
  $('persistenceLimit').addEventListener('change', onControlChange)

  figure.load()
}
