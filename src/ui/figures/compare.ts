// Figure 3. Side-effect free outside a browser. Never imports or is imported by the other two
// figures. Opens the shared docs card with BOTH people, because a ruler word is never one person's.

import * as api from '../api.js'
import { html, kinds, SOURCE_SEGMENTS, scoreName, sourceLabels, type Compare, type Measure } from '../format.js'
import * as docsCard from '../docs-card.js'
import { createCanvasMeasure, paintCompareDetail, paintCompareLoading, paintRuler, paintRulerError } from '../render.js'
import { runFigure } from '../figure.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { a?: string; b?: string; days?: string; source?: string; limit?: string; measure?: string }
// Distinct from an empty `people` array: an outage must never paint as "no one registered yet".
export type PeopleError = unknown

const $ = (id: string): any => document.getElementById(id)

const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

const resolvePerson = (people: Person[], seeded: string | undefined) =>
  seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? '')

// a === b is legal when the tracked list has only one person.
const resolveOther = (people: Person[], seeded: string | undefined, a: string) => {
  if (seeded && people.some((p) => p.id === seeded)) return seeded
  return people.find((p) => p.id !== a)?.id ?? a
}

export const mount = (root: FigureRoot, { people, initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let data: Compare | null = null
  let selected: { term: string; kind: string } | null = null
  let lastWidth = 0
  let metrics: Measure | null = null
  const measured = () => (metrics ??= createCanvasMeasure())

  const controlValues = () => ({
    a: $('compareA').value,
    b: $('compareB').value,
    days: $('compareDays').value,
    source: $('compareSource').value,
    limit: $('compareLimit').value,
  })
  const measure = () => $('compareMeasure').value

  const setHiddenNote = (hiddenCount: number) => {
    const note = $('compareHiddenNote')
    if (!note) return
    note.hidden = hiddenCount === 0
    note.textContent = hiddenCount ? `${hiddenCount} ${hiddenCount === 1 ? 'palavra deixada' : 'palavras deixadas'} de fora por ser o próprio nome de uma das duas pessoas.` : ''
  }

  const repaint = () => {
    if (!data) return
    if (!data.terms.length) {
      $('compareRuler').hidden = false
      $('compareRuler').innerHTML = '<p class="note">Nenhuma palavra neste recorte.</p>'
      $('compareDetail').innerHTML = '<span class="empty-hint">Clique numa palavra para ver os números dos dois lados.</span>'
      setHiddenNote(0)
      return
    }
    const { hiddenCount } = paintRuler({
      data,
      personA: data.a.person,
      personB: data.b.person,
      measure: measure(),
      metrics: measured(),
      selected,
      onPick: pick,
      width: lastWidth || undefined,
    })
    setHiddenNote(hiddenCount)
    const current = selected
    const term = current ? (data.terms.find((t) => t.term === current.term && t.kind === current.kind) ?? null) : null
    paintCompareDetail({ term, personA: data.a.person, personB: data.b.person })
  }

  // Selecting is a toggle; overflow buttons carry the same data-term/data-kind as drawn words.
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

  const showDocs = (word: { term: string; kind: string }) => {
    if (!data) return
    const values = { days: $('compareDays').value, source: $('compareSource').value }
    const side = (person: { id: string; name: string }) => ({
      personId: person.id,
      personName: person.name,
      label: person.name,
      query: api.docsParams({ ...values, term: word.term, kind: word.kind }),
    })
    docsCard.open({
      owner: 'compare',
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'}`,
      title: word.term,
      sides: [side(data.a.person), side(data.b.person)],
    })
  }

  const params = (): URLSearchParams | null => {
    if (peopleError) {
      data = null
      $('compareStatus').hidden = true
      $('compareRuler').hidden = true
      $('compareRuler').innerHTML = ''
      $('compareDetail').innerHTML =
        '<span class="empty-hint">Falha de rede ou base indisponível. <button class="quiet-button" id="compareRetry">Tentar novamente</button></span>'
      $('compareRetry')?.addEventListener('click', () => location.reload())
      setHiddenNote(0)
      return null
    }
    if (!people.length) {
      data = null
      $('compareStatus').hidden = true
      $('compareRuler').hidden = true
      $('compareRuler').innerHTML = ''
      $('compareDetail').innerHTML = '<span class="empty-hint">Nenhuma pessoa cadastrada.</span>'
      setHiddenNote(0)
      return null
    }
    return api.compareParams(controlValues())
  }

  const ghost = () => {
    if (data) root.classList.add('is-loading')
    else paintCompareLoading()
  }

  const dropStalePick = () => {
    if (docsCard.openedBy('compare')) docsCard.close()
    selected = null
  }

  const paint = (result: Compare) => {
    // A resize repaint calls this with the same object again; only a new dataset clears the pick,
    // and closes a card picked on the previous recorte during the reload debounce.
    const isNewData = result !== data
    data = result
    if (isNewData) dropStalePick()
    lastWidth = $('compareRuler').clientWidth || 0
    $('compareStatus').hidden = result.a.person.id !== result.b.person.id
    root.classList.remove('is-loading')
    repaint()
  }

  const paintError = () => {
    data = null
    dropStalePick()
    $('compareStatus').hidden = true
    root.classList.remove('is-loading')
    paintRulerError()
    $('compareDetail').innerHTML = '<span class="empty-hint">Clique numa palavra para ver os números dos dois lados.</span>'
    setHiddenNote(0)
  }

  const figure = runFigure<Compare>({
    name: 'compare',
    params,
    fetch: (queryParams, signal) => api.loadCompare(queryParams, signal),
    ghost,
    paint,
    paintError,
    el: $('compareRuler'),
    markSelector: '[data-term]',
    onRelease: releaseSelection,
  })

  const onControlChange = () => {
    figure.release()
    figure.reload()
  }

  // `measure` is not part of compareParams, so the payload is unchanged; repaint without fetch.
  const onMeasureChange = () => repaint()

  $('compareSource').innerHTML = html`${SOURCE_SEGMENTS.map(([value, text]) => html`<option value="${value}">${sourceLabels[value] ?? text}</option>`)}`
  $('compareMeasure').innerHTML = html`<option value="count">documentos</option><option value="pmi">${scoreName('pmi')}</option>`
  // Default 20: /api/compare unions four top-lists, so 40 per person yields ~130 terms on the wire.
  $('compareLimit').innerHTML = html`${['20', '40', '60', '100'].map((v) => html`<option value="${v}"${v === '20' ? ' selected' : ''}>${v}</option>`)}`
  $('compareA').innerHTML = ''
  $('compareB').innerHTML = ''
  for (const p of people) {
    $('compareA').add(new Option(p.name, p.id))
    $('compareB').add(new Option(p.name, p.id))
  }
  const aId = resolvePerson(people, initial.a)
  $('compareA').value = aId
  $('compareB').value = resolveOther(people, initial.b, aId)
  applySeed($('compareDays'), initial.days)
  applySeed($('compareSource'), initial.source)
  applySeed($('compareLimit'), initial.limit)
  applySeed($('compareMeasure'), initial.measure)

  for (const id of ['compareA', 'compareB', 'compareDays', 'compareSource', 'compareLimit']) $(id).addEventListener('change', onControlChange)
  $('compareMeasure').addEventListener('change', onMeasureChange)

  figure.load()
}
