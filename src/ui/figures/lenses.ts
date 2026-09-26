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
  // fill the two lens selects' own "Veículo" optgroup; a transient failure never blocks the
  // figure's own load(). The generation counter plus the captured person/days guard against a
  // stale response writing another person's or window's hosts in; `false` means nothing wrote.
  let outletsGen = 0
  const loadOutlets = async (): Promise<boolean> => {
    if (peopleError || !people.length) return false
    const id = personId()
    if (!id) return false
    const days = $('lensesDays').value
    const gen = ++outletsGen
    try {
      const rows: OutletRow[] = await api.loadSources(id, api.sourcesParams({ days, sort: 'count', limit: '80', source: 'all' }))
      if (gen !== outletsGen || personId() !== id || $('lensesDays').value !== days) return false
      const seen = new Set<string>()
      const domains = rows.filter((r) => r.domain && !seen.has(r.domain) && seen.add(r.domain))
      const optionsHtml = html`${domains.map((r) => html`<option value="domain:${r.domain}">${r.domain}</option>`)}`
      if ($('lensesAOutlets')) $('lensesAOutlets').innerHTML = optionsHtml
      if ($('lensesBOutlets')) $('lensesBOutlets').innerHTML = optionsHtml
      return true
    } catch {
      // Leaves the selects with whatever options they already had.
      return false
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
    // A resize repaint calls this with the same object again (figure.ts's own repaint());
    // only a genuinely new dataset clears the pick. A pick made between a control change and
    // this new data landing opened its own card against the old lens labels; that card must
    // close here too, or it survives showing rows from a recorte no control asks for any more.
    const isNewData = result !== data
    data = result
    if (isNewData) {
      if (docsCard.openedBy('lenses')) docsCard.close()
      selected = null
    }
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

  // Set per select, only by an actual change to that select (or to the person, which can
  // invalidate a domain on either side), so the initial seed's own deferred continuation never
  // overwrites whichever one the reader touched -- but a lensesLimit/lensesDays change, neither
  // of which says anything about which domain either side should show, discards neither.
  let touchedA = false
  let touchedB = false

  // figure.release() (week.ts's own pattern), not just `selected = null`: a control here must
  // not shut a card the atlas or the compare ruler is showing, or leave one open with stale rows.
  const onLensAChange = () => {
    touchedA = true
    figure.release()
    figure.reload()
  }

  const onLensBChange = () => {
    touchedB = true
    figure.release()
    figure.reload()
  }

  const onLimitChange = () => {
    figure.release()
    figure.reload()
  }

  const hasOption = (select: any, value: string) => [...select.options].some((o: any) => o.value === value)

  // The domain optgroup is rebuilt by loadOutlets whenever the person or the window changes; a
  // currently-selected domain that survives the refill is kept, else the select falls back to
  // 'all' explicitly. Exits early, leaving both selects untouched, when loadOutlets wrote
  // nothing (a stale response).
  const refreshOutletsPreserving = async () => {
    const prevA = $('lensesA').value
    const prevB = $('lensesB').value
    const applied = await loadOutlets()
    if (!applied) return
    $('lensesA').value = hasOption($('lensesA'), prevA) ? prevA : 'all'
    $('lensesB').value = hasOption($('lensesB'), prevB) ? prevB : 'all'
  }

  const onPersonChange = async () => {
    // A new person may not have the domain either side is currently seeded to land on.
    touchedA = true
    touchedB = true
    figure.release()
    await refreshOutletsPreserving()
    figure.reload()
  }

  const onDaysChange = async () => {
    figure.release()
    await refreshOutletsPreserving()
    figure.reload()
  }

  const isDomainSeed = (v: string | undefined): v is string => typeof v === 'string' && v.startsWith('domain:')

  $('lensesPerson').innerHTML = ''
  for (const p of people) $('lensesPerson').add(new Option(p.name, p.id))
  $('lensesPerson').value = resolvePerson(people, initial.person)
  applySeed($('lensesDays'), initial.days)
  applySeed($('lensesLimit'), initial.limit)
  // A domain seed's own <option> does not exist until loadOutlets fills it in; only that kind
  // is deferred below, so lean:/source:/all seeds apply now, before the reader can touch a control.
  if (!isDomainSeed(initial.a)) applySeed($('lensesA'), initial.a)
  if (!isDomainSeed(initial.b)) applySeed($('lensesB'), initial.b)

  $('lensesA').addEventListener('change', onLensAChange)
  $('lensesB').addEventListener('change', onLensBChange)
  $('lensesLimit').addEventListener('change', onLimitChange)
  $('lensesDays').addEventListener('change', onDaysChange)
  $('lensesPerson').addEventListener('change', onPersonChange)

  loadOutlets().then((applied) => {
    if (applied) {
      if (isDomainSeed(initial.a) && !touchedA) applySeed($('lensesA'), initial.a)
      if (isDomainSeed(initial.b) && !touchedB) applySeed($('lensesB'), initial.b)
    }
    figure.load()
  })
}
