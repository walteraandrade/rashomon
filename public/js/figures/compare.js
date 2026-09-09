// Figure 3, end to end: its own sentence (person A, person B, days, source, measure, limit),
// the ruler and its detail line, GET /api/compare and nothing else. Importing this module is
// side-effect free outside a browser: mount() runs only once app.js hands it a root element and
// the fetched person list, which is what lets node:test import it with no document. Nothing
// here imports or is imported by figures/atlas.js or figures/testimony.js (issue #92's
// invariant, extended to this third figure by issue #91): no word rendered here ever opens
// #docsDialog, and this figure never reads or releases the other two figures' own state.

import * as api from '../api.js'
import { SOURCE_SEGMENTS, scoreName, sourceLabels } from '../format.js'
import { paintCompareDetail, paintCompareLoading, paintRuler, paintRulerError } from '../render.js'
import { debounce, fromScope, readScope } from '../state.js'

/** @typedef {{ id: string, name: string }} Person */
/** @typedef {{ a?: string, b?: string, days?: string, source?: string, limit?: string, measure?: string }} Seed */
// Whatever GET /api/people rejected with, or null when it answered. Distinct from an empty
// `people` array: an outage must never paint as "no one is registered yet" (issue #92).
/** @typedef {unknown} PeopleError */

// Elements this figure owns by id. The markup in design-5.html guarantees each one exists
// inside #compare.
/** @type {(id: string) => any} */
const $ = (id) => document.getElementById(id)

/** @param {unknown} e */
const aborted = (e) => e instanceof Error && e.name === 'AbortError'

// A seeded value only ever overrides a <select> when it names one of that select's own
// options; a malformed value leaves the element at its default index, and nothing throws.
/** @param {any} select @param {string | undefined} value */
const applySeed = (select, value) => {
  if (value === undefined || !select) return
  if ([...select.options].some((/** @type {any} */ o) => o.value === value)) select.value = value
}

/** @param {Person[]} people @param {string | undefined} seeded */
const resolvePerson = (people, seeded) => (seeded && people.some((p) => p.id === seeded) ? seeded : (people[0]?.id ?? ''))

// b falls back to the second distinct tracked person, or a's own id when the tracked list has
// only one person -- a === b is then a reachable, legal state (matches /api/compare AC10), not
// a guarded error (issue #91 §2).
/** @param {Person[]} people @param {string | undefined} seeded @param {string} a */
const resolveOther = (people, seeded, a) => {
  if (seeded && people.some((p) => p.id === seeded)) return seeded
  return people.find((p) => p.id !== a)?.id ?? a
}

// Mounts figure 3 into `root` (#compare): populates its own sentence's controls from `people`
// and `initial`, wires every listener, and runs the first load.
/** @param {any} root @param {{ people: Person[], initial: Seed, peopleError?: PeopleError }} args */
export const mount = (root, { people, initial, peopleError = null }) => {
  /** @type {import('../format.js').Compare | null} */
  let data = null
  /** @type {{ term: string, kind: string } | null} */
  let selected = null
  let lastWidth = 0
  let requestId = 0
  /** @type {AbortController | null} */
  let controller = null

  const controlValues = () => ({
    a: $('compareA').value,
    b: $('compareB').value,
    days: $('compareDays').value,
    source: $('compareSource').value,
    limit: $('compareLimit').value,
  })
  const measure = () => $('compareMeasure').value

  const setHiddenNote = (/** @type {number} */ hiddenCount) => {
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
      $('compareRuler').hidden = true
      $('compareRuler').innerHTML = ''
      $('compareDetail').innerHTML = '<span class="empty-hint">Nenhuma palavra neste recorte.</span>'
      setHiddenNote(0)
      return
    }
    const { hiddenCount } = paintRuler({
      data,
      personA: data.a.person,
      personB: data.b.person,
      measure: measure(),
      selected,
      onPick: pick,
      width: lastWidth || undefined,
    })
    setHiddenNote(hiddenCount)
    const current = selected
    const term = current ? (data.terms.find((t) => t.term === current.term && t.kind === current.kind) ?? null) : null
    paintCompareDetail({ term, personA: data.a.person, personB: data.b.person })
  }

  // Selecting a dot is a toggle, same idiom as the strip's outlet dots and the atlas's own
  // words: clicking the selected dot again lets it go.
  /** @param {string} term @param {string} kind */
  const pick = (term, kind) => {
    selected = selected && selected.term === term && selected.kind === kind ? null : { term, kind }
    repaint()
  }

  const releaseSelection = () => {
    if (!selected) return
    selected = null
    repaint()
  }

  /** @param {Element | null} target */
  const background = (target) => {
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
      const result = await fromScope('compare', key, () => api.loadCompare(params, /** @type {AbortController} */ (controller).signal))
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

  // The sentence's controls: source, measure and limit are built here (they have no static
  // markup); days keeps its design-5.html options. Both people selects share the tracked list;
  // `a` takes a seeded value (or the bare `person=`, resolved by app.js), `b` falls back to the
  // second distinct person.
  $('compareSource').innerHTML = SOURCE_SEGMENTS.map(([value, text]) => `<option value="${value}">${sourceLabels[value] ?? text}</option>`).join('')
  $('compareMeasure').innerHTML = `<option value="count">documentos</option><option value="pmi">${scoreName('pmi')}</option>`
  $('compareLimit').innerHTML = ['20', '40', '60', '100'].map((v) => `<option value="${v}"${v === '40' ? ' selected' : ''}>${v}</option>`).join('')
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

  for (const id of ['compareA', 'compareB', 'compareDays', 'compareSource', 'compareMeasure', 'compareLimit']) $(id).addEventListener('change', onControlChange)
  $('compareRuler').addEventListener('click', (/** @type {MouseEvent} */ e) => background(/** @type {Element | null} */ (e.target)))
  new ResizeObserver(() => {
    const width = $('compareRuler').clientWidth
    if (data && data.terms.length && width && width !== lastWidth) {
      lastWidth = width
      repaint()
    }
  }).observe($('compareRuler'))

  load()
}
