// Figure 6 (issue #206). Side-effect free outside a browser. Never imports or is imported by
// the other five figures. Opens the shared docs card with two sides — one per lens, both the
// same person — because a lens word is never one side's alone, just like figure 3's ruler.

import * as api from '../api.js'
import { html, kinds, lensLabel, type Lenses, type Measure, type OutletRow } from '../format.js'
import * as docsCard from '../docs-card.js'
import { createCanvasMeasure, paintLensDetail, paintLensRuler, paintLensRulerError, paintLensesLoading } from '../render.js'
import { runFigure } from '../figure.js'

export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { person?: string; a?: string; b?: string; days?: string; limit?: string }
// Distinct from an empty `people` array: an outage must never paint as "no one registered yet".
export type PeopleError = unknown

const $ = (id: string): any => document.getElementById(id)

const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

const resolvePerson = (people: Person[], seeded: string | undefined) =>
  seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? '')

// Turns a normalized lens token (domain:<host>, lean:<value>, source:<name>, all) into the
// /docs query that lens implies, on the given term/kind. `source` stays 'all' for a domain or
// lean lens, since domain/lean and source are independent filters on /docs already.
const lensDocsQuery = (lens: string, days: string, term: string, kind: string) => {
  if (lens.startsWith('domain:')) return api.docsParams({ days, source: 'all', domain: lens.slice('domain:'.length), term, kind })
  if (lens.startsWith('lean:')) return api.docsParams({ days, source: 'all', lean: lens.slice('lean:'.length), term, kind })
  if (lens.startsWith('source:')) return api.docsParams({ days, source: lens.slice('source:'.length), term, kind })
  return api.docsParams({ days, source: 'all', term, kind })
}

export const mount = (root: FigureRoot, { people, initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let data: Lenses | null = null
  let selected: { term: string; kind: string } | null = null
  let lastWidth = 0
  let metrics: Measure | null = null
  const measured = () => (metrics ??= createCanvasMeasure())

  const personId = () => $('lensesPerson').value

  const setHiddenNote = (hiddenCount: number) => {
    const note = $('lensesHiddenNote')
    if (!note) return
    note.hidden = hiddenCount === 0
    note.textContent = hiddenCount ? `${hiddenCount} ${hiddenCount === 1 ? 'palavra deixada' : 'palavras deixadas'} de fora por ser o próprio nome da pessoa.` : ''
  }

  const repaint = () => {
    if (!data) return
    const endA = lensLabel(data.a.lens)
    const endB = lensLabel(data.b.lens)
    if (!data.terms.length) {
      $('lensesRuler').hidden = false
      $('lensesRuler').innerHTML = '<p class="note">Nenhuma palavra neste recorte.</p>'
      paintLensDetail({ term: null, endA, endB })
      setHiddenNote(0)
      return
    }
    const { hiddenCount } = paintLensRuler({
      data,
      endA,
      endB,
      metrics: measured(),
      selected,
      onPick: pick,
      width: lastWidth || undefined,
    })
    setHiddenNote(hiddenCount)
    const current = selected
    const term = current ? (data.terms.find((t) => t.term === current.term && t.kind === current.kind) ?? null) : null
    paintLensDetail({ term, endA, endB })
  }

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
    const id = personId()
    const person = people.find((p) => p.id === id)
    const days = $('lensesDays').value
    const side = (lens: string) => ({
      personId: id,
      personName: person?.name ?? id,
      label: lensLabel(lens),
      query: lensDocsQuery(lens, days, word.term, word.kind),
    })
    docsCard.open({
      owner: 'lenses',
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'}`,
      title: word.term,
      sides: [side(data.a.lens), side(data.b.lens)],
    })
  }

  // Top-80 domains for this person (same /sources call figure 2 already makes), used only to
  // fill the two lens selects' own "Veículo" optgroup; a transient failure here leaves whatever
  // options were already there, and never blocks the figure's own load().
  const loadOutlets = async () => {
    if (peopleError || !people.length) return
    const id = personId()
    if (!id) return
    try {
      const rows: OutletRow[] = await api.loadSources(id, api.sourcesParams({ days: $('lensesDays').value, sort: 'count', limit: '80', source: 'all' }))
      const seen = new Set<string>()
      const domains = rows.filter((r) => r.domain && !seen.has(r.domain) && seen.add(r.domain))
      const optionsHtml = html`${domains.map((r) => html`<option value="domain:${r.domain}">${r.domain}</option>`)}`
      if ($('lensesAOutlets')) $('lensesAOutlets').innerHTML = optionsHtml
      if ($('lensesBOutlets')) $('lensesBOutlets').innerHTML = optionsHtml
    } catch {
      // Leaves the selects with whatever options they already had.
    }
  }

  const params = (): URLSearchParams | null => {
    if (peopleError) {
      data = null
      $('lensesStatus').hidden = true
      $('lensesRuler').hidden = true
      $('lensesRuler').innerHTML = ''
      $('lensesDetail').innerHTML =
        '<span class="empty-hint">Falha de rede ou base indisponível. <button class="quiet-button" id="lensesRetry">Tentar novamente</button></span>'
      $('lensesRetry')?.addEventListener('click', () => location.reload())
      setHiddenNote(0)
      return null
    }
    if (!people.length) {
      data = null
      $('lensesStatus').hidden = true
      $('lensesRuler').hidden = true
      $('lensesRuler').innerHTML = ''
      $('lensesDetail').innerHTML = '<span class="empty-hint">Nenhuma pessoa cadastrada.</span>'
      setHiddenNote(0)
      return null
    }
    const qp = api.lensesParams({ a: $('lensesA').value, b: $('lensesB').value, days: $('lensesDays').value, limit: $('lensesLimit').value })
    qp.set('person', personId())
    return qp
  }

  const ghost = () => {
    if (data) root.classList.add('is-loading')
    else paintLensesLoading()
  }

  const paint = (result: Lenses) => {
    data = result
    selected = null
    lastWidth = $('lensesRuler').clientWidth || 0
    $('lensesStatus').hidden = result.a.lens !== result.b.lens
    root.classList.remove('is-loading')
    repaint()
  }

  const paintError = () => {
    data = null
    $('lensesStatus').hidden = true
    root.classList.remove('is-loading')
    paintLensRulerError()
    $('lensesDetail').innerHTML = '<span class="empty-hint">Clique numa palavra para ver os números das duas lentes.</span>'
    setHiddenNote(0)
  }

  const figure = runFigure<Lenses>({
    name: 'lenses',
    params,
    fetch: (queryParams, signal) =>
      api.loadLenses(
        queryParams.get('person')!,
        api.lensesParams({ a: queryParams.get('a')!, b: queryParams.get('b')!, days: queryParams.get('days')!, limit: queryParams.get('limit')! }),
        signal,
      ),
    ghost,
    paint,
    paintError,
    detail: (_data, queryParams) => ({ person: queryParams.get('person') }),
    el: $('lensesRuler'),
    markSelector: '[data-term]',
    onRelease: releaseSelection,
  })

  const onControlChange = () => {
    selected = null
    figure.reload()
  }

  const hasOption = (select: any, value: string) => [...select.options].some((o: any) => o.value === value)

  // The domain optgroup is rebuilt by loadOutlets whenever the person or the window changes;
  // a currently-selected domain that survives the refill is kept, otherwise the select falls
  // back to 'all' explicitly rather than whatever option the browser's own reset lands on.
  const refreshOutletsPreserving = async () => {
    const prevA = $('lensesA').value
    const prevB = $('lensesB').value
    await loadOutlets()
    $('lensesA').value = hasOption($('lensesA'), prevA) ? prevA : 'all'
    $('lensesB').value = hasOption($('lensesB'), prevB) ? prevB : 'all'
  }

  const onPersonChange = async () => {
    selected = null
    await refreshOutletsPreserving()
    figure.reload()
  }

  const onDaysChange = async () => {
    selected = null
    await refreshOutletsPreserving()
    figure.reload()
  }

  $('lensesPerson').innerHTML = ''
  for (const p of people) $('lensesPerson').add(new Option(p.name, p.id))
  $('lensesPerson').value = resolvePerson(people, initial.person)
  applySeed($('lensesDays'), initial.days)
  applySeed($('lensesLimit'), initial.limit)

  for (const id of ['lensesA', 'lensesB', 'lensesLimit']) $(id).addEventListener('change', onControlChange)
  $('lensesDays').addEventListener('change', onDaysChange)
  $('lensesPerson').addEventListener('change', onPersonChange)

  loadOutlets().then(() => {
    applySeed($('lensesA'), initial.a)
    applySeed($('lensesB'), initial.b)
    figure.load()
  })
}
