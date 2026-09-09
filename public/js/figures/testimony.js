// Figure 2, end to end: its own sentence (person, days, source — no sort/limit, matching what
// /sources and /testimony actually read), the strip, the testimony list, the outlet list,
// picking and releasing the focused outlet, and its own ResizeObserver on #strip. Importing
// this module is side-effect free outside a browser: mount() runs only once app.js hands it a
// root element and the fetched person list, which is what lets node:test import it with no
// document. Nothing here imports or calls into figures/atlas.js, and nothing there calls into
// this file either (issue #92).

import * as api from '../api.js'
import { SOURCE_SEGMENTS, sourceLabels } from '../format.js'
import * as docsCard from '../docs-card.js'
import { paintOutlets, paintOutletsError, paintStrip, paintTestimony, paintTestimonyError, paintTestimonyLoading } from '../render.js'
import { debounce, fromScope, readScope } from '../state.js'

/** @typedef {{ id: string, name: string }} Person */
/** @typedef {{ person?: string, days?: string, source?: string }} Seed */
// Whatever GET /api/people rejected with, or null when it answered. Distinct from an empty
// `people` array: an outage must never paint as "no one is registered yet" (issue #92).
/** @typedef {unknown} PeopleError */

// Elements this figure owns by id. The markup in design-5.html guarantees each one exists
// inside #testimony.
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

// Mounts figure 2 into `root` (#testimony): populates its own sentence's controls from
// `people` and `initial`, wires every listener, and runs the first load.
/** @param {any} root @param {{ people: Person[], initial: Seed, peopleError?: PeopleError }} args */
export const mount = (root, { people, initial, peopleError = null }) => {
  /** @type {import('../format.js').Testimony | null} */
  let testimony = null
  /** @type {import('../format.js').OutletRow[] | null} */
  let outletRows = null
  let outlet = 'all'
  let lastStripWidth = 0
  let requestId = 0
  /** @type {AbortController | null} */
  let controller = null

  // narrowToSources/narrowToTestimony drop sort and limit regardless of what travels in, so a
  // constant placeholder for both keeps this figure on api.js's existing, unchanged functions
  // without a sort/limit control of its own.
  const controlValues = () => ({ days: $('testimonyDays').value, sort: 'count', limit: '18', source: $('testimonySource').value })
  /** @param {string} personId @param {URLSearchParams} params */
  const scopeKey = (personId, params) => personId + '?' + params

  // Every painter of this figure, over the data the flows already resolved. Each one is a
  // no-op without its data, so this is safe before the first load answers.
  const repaint = () => {
    if (testimony) {
      paintTestimony({ data: testimony, domain: outlet, onPick: pickOutlet })
      paintStrip({ data: testimony, domain: outlet, onPick: pickOutlet, width: lastStripWidth || undefined })
    }
    if (outletRows) paintOutlets({ rows: outletRows, testimony, domain: outlet, onPick: pickOutlet })
  }

  // Picking an outlet does two things, and neither of them touches figure 1: it repaints this
  // figure from the data already in hand, and it asks the shared card for that outlet's own
  // texts. A number you cannot read the texts behind is exactly where a reader stops trusting
  // it, so the mean and its evidence answer to the same click. Releasing puts the card away.
  /** @param {string} d */
  const pickOutlet = (d) => {
    if (d === outlet) return
    outlet = d
    repaint()
    if (d === 'all') docsCard.close()
    else showOutletDocs(d)
  }

  const releaseOutlet = () => pickOutlet('all')

  // This figure's own reading, handed to the shared card: every text this outlet wrote about
  // this figure's person, in this figure's period and source -- no term at all, which is what
  // makes it a different question from the atlas's "textos com esta palavra".
  /** @param {string} d */
  const showOutletDocs = (d) => {
    const personId = $('testimonyPerson').value
    if (!personId) return
    const person = people.find((p) => p.id === personId)
    const values = controlValues()
    docsCard.open({
      kicker: 'Documentos de',
      title: d,
      sides: [{ personId, personName: person?.name ?? personId, query: api.docsParams({ days: values.days, source: values.source, domain: d }) }],
    })
  }

  /** @param {number} id @param {AbortSignal} signal */
  const loadSourcesFlow = async (id, signal) => {
    const person = $('testimonyPerson').value
    const params = api.sourcesParams(controlValues())
    try {
      const rows = await fromScope('sources', scopeKey(person, params), () => api.loadSources(person, params, signal))
      if (id !== requestId) return
      outletRows = rows
      repaint()
    } catch (e) {
      if (id === requestId && !aborted(e)) paintOutletsError()
    }
  }

  /** @param {number} id @param {AbortSignal} signal */
  const loadTestimonyFlow = async (id, signal) => {
    const person = $('testimonyPerson').value
    const params = api.testimonyParams(controlValues())
    const key = scopeKey(person, params)
    if (!readScope('testimony', key)) {
      testimony = null
      paintTestimonyLoading()
    }
    try {
      const data = await fromScope('testimony', key, () => api.loadTestimony(person, params, signal))
      if (id !== requestId) return
      testimony = data
      lastStripWidth = $('strip').clientWidth || 0
      // The outlet list needs this payload too (it carries the means), so it repaints here
      // even though its own /sources call may have answered long before.
      repaint()
    } catch (e) {
      if (id === requestId && !aborted(e)) {
        testimony = null
        paintTestimonyError()
      }
    }
  }

  const load = () => {
    const id = ++requestId
    controller?.abort()
    controller = new AbortController()
    outlet = 'all'
    // Same distinction as figure 1: an /api/people outage is not an empty seed, and gets a
    // retry that reloads the page, the only way this figure can ask the shell to fetch again.
    if (peopleError) {
      testimony = null
      outletRows = null
      $('testimonyList').innerHTML =
        '<p class="note">Falha de rede ou base indisponível.<br>Nenhuma avaliação fictícia será exibida.<br><br><button class="quiet-button" id="testimonyRetry">Tentar novamente</button></p>'
      $('outletList').textContent = ''
      $('strip').hidden = true
      $('testimonyRetry')?.addEventListener('click', () => location.reload())
      return
    }
    if (!people.length) {
      testimony = null
      outletRows = null
      $('testimonyList').textContent = 'Nenhuma pessoa cadastrada.'
      $('outletList').textContent = ''
      $('strip').hidden = true
      return
    }
    loadSourcesFlow(id, controller.signal)
    loadTestimonyFlow(id, controller.signal)
  }

  const debouncedLoad = debounce(load)

  // The recorte's own person, period and source controls are figure-2-private: changing any
  // of them releases the outlet in focus locally (the coupling used to run through the shared
  // person control; now each figure owns its own release, issue #92) and reloads this figure
  // only, never figure 1.
  const onControlChange = () => {
    outlet = 'all'
    debouncedLoad()
  }

  /** @param {Element | null} target */
  const background = (target) => {
    if (target && target.closest('[data-domain], [data-testimony-domain], [data-strip-domain]')) return
    releaseOutlet()
  }

  // This figure's own sentence: source is built here (it has no static markup), days keeps
  // its design-5.html options, both only take a seeded value when it names one of them.
  $('testimonySource').innerHTML = SOURCE_SEGMENTS.map(([value, text]) => `<option value="${value}">${sourceLabels[value] ?? text}</option>`).join('')
  applySeed($('testimonySource'), initial.source)
  $('testimonyPerson').innerHTML = ''
  for (const p of people) $('testimonyPerson').add(new Option(p.name, p.id))
  $('testimonyPerson').value = resolvePerson(people, initial.person)
  applySeed($('testimonyDays'), initial.days)

  $('testimonyPerson').addEventListener('change', onControlChange)
  $('testimonyDays').addEventListener('change', onControlChange)
  $('testimonySource').addEventListener('change', onControlChange)
  for (const id of ['strip', 'testimonyList', 'outletList'])
    $(id).addEventListener('click', (/** @type {MouseEvent} */ e) => background(/** @type {Element | null} */ (e.target)))
  new ResizeObserver(() => {
    const width = $('strip').clientWidth
    if (testimony && width && width !== lastStripWidth) {
      lastStripWidth = width
      paintStrip({ data: testimony, domain: outlet, onPick: pickOutlet, width })
    }
  }).observe($('strip'))

  load()
}
