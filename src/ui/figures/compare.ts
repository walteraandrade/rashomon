// Figure 3, end to end: its own sentence (person A, person B, days, source, measure, limit),
// the ruler and its detail line, GET /api/compare and nothing else. Importing this module is
// side-effect free outside a browser: mount() runs only once app.ts hands it a root element and
// the fetched person list, which is what lets node:test import it with no document. Nothing
// here imports or is imported by figures/atlas.ts or figures/testimony.ts (issue #92's
// invariant, extended to this third figure by issue #91): this figure never reads or releases
// the other two figures' own state. It does open the shared documents card (docs-card.ts), which
// belongs to no figure -- and it opens it with BOTH people at once, because a word on this ruler
// is never one person's: showing only the side it leans to would answer half the question the
// figure asks.

import * as api from '../api.js'
import { kinds, SOURCE_SEGMENTS, scoreName, sourceLabels, type Compare, type Measure } from '../format.js'
import * as docsCard from '../docs-card.js'
import { createCanvasMeasure, paintCompareDetail, paintCompareLoading, paintRuler, paintRulerError } from '../render.js'
import { debounce, fromScope, readScope } from '../state.js'

// The section element the shell mounts into. Only `classList` is ever read off it, and the
// suites mount against a DOM stand-in rather than a real element, so the contract is that one
// property instead of the whole HTMLElement surface.
export type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

export type Person = { id: string; name: string }
export type Seed = { a?: string; b?: string; days?: string; source?: string; limit?: string; measure?: string }
// Whatever GET /api/people rejected with, or null when it answered. Distinct from an empty
// `people` array: an outage must never paint as "no one is registered yet" (issue #92).
export type PeopleError = unknown

// Elements this figure owns by id. The markup in design-5.html guarantees each one exists
// inside #compare.
const $ = (id: string): any => document.getElementById(id)

const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError'

// A seeded value only ever overrides a <select> when it names one of that select's own
// options; a malformed value leaves the element at its default index, and nothing throws.
const applySeed = (select: any, value: string | undefined) => {
  if (value === undefined || !select) return
  if ([...select.options].some((o: any) => o.value === value)) select.value = value
}

const resolvePerson = (people: Person[], seeded: string | undefined) =>
  seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? '')

// b falls back to the second distinct tracked person, or a's own id when the tracked list has
// only one person -- a === b is then a reachable, legal state (matches /api/compare AC10), not
// a guarded error (issue #91 §2).
const resolveOther = (people: Person[], seeded: string | undefined, a: string) => {
  if (seeded && people.some((p) => p.id === seeded)) return seeded
  return people.find((p) => p.id !== a)?.id ?? a
}

// Mounts figure 3 into `root` (#compare): populates its own sentence's controls from `people`
// and `initial`, wires every listener, and runs the first load.
export const mount = (root: FigureRoot, { people, initial, peopleError = null }: { people: Person[]; initial: Seed; peopleError?: PeopleError }) => {
  let data: Compare | null = null
  let selected: { term: string; kind: string } | null = null
  let lastWidth = 0
  let requestId = 0
  let controller: AbortController | null = null
  // The injected text measurer layout.ts's rulerLayout needs, built on first paint and kept:
  // the same lazy idiom figures/atlas.ts uses, so importing this module still touches no
  // document.
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

  // Every painter of this figure, over the data the flow already resolved. A no-op without
  // `data`, so this is safe before the first load answers.
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

  // Selecting a word is a toggle, same idiom as the strip's outlet dots and the atlas's own
  // words: clicking the selected word again lets it go. The overflow list's buttons carry the
  // same data-term/data-kind, so a word that did not fit selects exactly like a drawn one.
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

  // Both sides, side by side. The two queries differ only in the person they are nested under:
  // same word, same period, same source, so the card is a fair comparison and not two recortes
  // that happen to share a title.
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
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'}`,
      title: word.term,
      sides: [side(data.a.person), side(data.b.person)],
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
      $('compareStatus').hidden = true
      $('compareRuler').hidden = true
      $('compareRuler').innerHTML = ''
      $('compareDetail').innerHTML =
        '<span class="empty-hint">Falha de rede ou base indisponível. <button class="quiet-button" id="compareRetry">Tentar novamente</button></span>'
      $('compareRetry')?.addEventListener('click', () => location.reload())
      setHiddenNote(0)
      return
    }
    if (!people.length) {
      data = null
      $('compareStatus').hidden = true
      $('compareRuler').hidden = true
      $('compareRuler').innerHTML = ''
      $('compareDetail').innerHTML = '<span class="empty-hint">Nenhuma pessoa cadastrada.</span>'
      setHiddenNote(0)
      return
    }
    const params = api.compareParams(controlValues())
    const key = params.toString()
    if (!readScope('compare', key)) paintCompareLoading()
    try {
      const result = await fromScope('compare', key, () => api.loadCompare(params, (controller as AbortController).signal))
      if (id !== requestId) return
      data = result
      selected = null
      lastWidth = $('compareRuler').clientWidth || 0
      $('compareStatus').hidden = result.a.person.id !== result.b.person.id
      repaint()
    } catch (e) {
      if (id === requestId && !aborted(e)) {
        data = null
        $('compareStatus').hidden = true
        paintRulerError()
        $('compareDetail').innerHTML = '<span class="empty-hint">Clique numa palavra para ver os números dos dois lados.</span>'
        setHiddenNote(0)
      }
    }
  }

  const debouncedLoad = debounce(load)

  // This figure's own controls: changing any of them releases the selected dot and reloads
  // this figure only, never figure 1 or figure 2.
  const onControlChange = () => {
    selected = null
    debouncedLoad()
  }

  // `measure` is the exception, and deliberately so: it is not part of compareParams, so the
  // response already carries both numbers for every term and only the position has to move.
  // Reloading here would resolve from state.ts's memo inside its TTL and pay a real round trip
  // outside it, for a payload identical to the one on screen. Zero fetches, one repaint, and
  // the selected word survives — the reader is looking at the same word through another lens.
  const onMeasureChange = () => repaint()

  // The sentence's controls: source, measure and limit are built here (they have no static
  // markup); days keeps its design-5.html options. Both people selects share the tracked list;
  // `a` takes a seeded value (or the bare `person=`, resolved by app.ts), `b` falls back to the
  // second distinct person.
  $('compareSource').innerHTML = SOURCE_SEGMENTS.map(([value, text]) => `<option value="${value}">${sourceLabels[value] ?? text}</option>`).join('')
  $('compareMeasure').innerHTML = `<option value="count">documentos</option><option value="pmi">${scoreName('pmi')}</option>`
  // Default 20, not 40: /api/compare unions four top-lists (each side's most frequent and each
  // side's stickiest), so "40 por pessoa" is ~130 words on the wire. A dot that small still
  // reads; a word does not, and 20 lands near 65, which fits the strip whole at both widths.
  $('compareLimit').innerHTML = ['20', '40', '60', '100'].map((v) => `<option value="${v}"${v === '20' ? ' selected' : ''}>${v}</option>`).join('')
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
  $('compareRuler').addEventListener('click', (e: MouseEvent) => background(e.target as Element | null))
  new ResizeObserver(() => {
    const width = $('compareRuler').clientWidth
    if (data && data.terms.length && width && width !== lastWidth) {
      lastWidth = width
      repaint()
    }
  }).observe($('compareRuler'))

  load()
}
