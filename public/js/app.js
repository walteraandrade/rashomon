// The page's shell: fetches the person list exactly once, then mounts every figure onto its
// own section, handing each one that list plus the slice of the querystring it seeded on. Each
// figure owns its own controls, its own fetches and its own state from here on (see
// public/js/figures/atlas.js, testimony.js and compare.js); nothing here reaches back
// into a figure's DOM once it is mounted, and no figure imports another. Importing this module
// is side-effect free outside a browser: boot() runs only when a `document` exists, which is
// what lets node:test import the pieces below.

import { mount as mountAtlas } from './figures/atlas.js'
import { mount as mountCompare } from './figures/compare.js'
import { mount as mountTestimony } from './figures/testimony.js'

/** @typedef {{ id: string, name: string }} Person */
// A plain key reads the same-named bare querystring param as its fallback (`days` falls back to
// `?days=`); a `[key, bareKey | null]` pair names a different bare fallback (figure 3's `a`
// falls back to the page-wide `?person=`) or none at all (`null`, for a key with no bare
// equivalent, like figure 3's `b` and `measure` -- issue #91 §2).
/** @typedef {string | [string, string | null]} SeedKey */

// One entry per figure: the section it mounts into, the client-side querystring keys it reads
// (bare, or prefixed with its own id) and the mount function it owns end to end. Order is the
// mount order, which is also the order app.js's shell runs in — figure 1, then figure 2, then
// figure 3. `noticeId` is the element each figure's own loading copy lands on, so the shell can
// replace that copy when the figure never gets far enough to repaint it itself.
const FIGURES = [
  { id: 'atlas', sectionId: 'workspace', keys: /** @type {SeedKey[]} */ (['person', 'days', 'source', 'sort', 'limit']), noticeId: 'status', mount: mountAtlas },
  { id: 'testimony', sectionId: 'testimony', keys: /** @type {SeedKey[]} */ (['person', 'days', 'source']), noticeId: 'testimonyList', mount: mountTestimony },
  {
    id: 'compare',
    sectionId: 'compare',
    keys: /** @type {SeedKey[]} */ ([['a', 'person'], ['b', null], 'days', 'source', 'limit', ['measure', null]]),
    noticeId: 'compareDetail',
    mount: mountCompare,
  },
]

// A prefixed value (`atlas.days=`) overrides the bare one (`days=`) for that figure only; a
// key with neither is left undefined, so the figure's own applySeed/resolvePerson decide the
// default exactly as if no querystring were there at all. Read-only: nothing here ever writes
// back to location/history.
/**
 * @param {string} figureId
 * @param {SeedKey[]} keys
 * @param {string} search
 */
const seedFor = (figureId, keys, search) => {
  const params = new URLSearchParams(search)
  return Object.fromEntries(
    keys.map((entry) => {
      const [key, bareKey] = Array.isArray(entry) ? entry : [entry, entry]
      const prefixed = params.get(`${figureId}.${key}`)
      const bare = bareKey ? params.get(bareKey) : null
      return [key, prefixed ?? bare ?? undefined]
    }),
  )
}

// Not routed through api.js on purpose: the shell mounts figures, nothing else, and api.js
// is each figure's own dependency (test/atlas-modules-acceptance.test.ts's import graph keeps
// app.js's own imports down to the figures it mounts).
/** @returns {Promise<Person[]>} */
const loadPeople = async () => {
  const res = await fetch('/api/people')
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

// Loading copy at parse time, before the network round trip resolves, so a cold start (a
// Vercel function waking up, a slow first request) shows the same "loading" reader as every
// later load instead of bare static markup. Each figure's own load() repaints this exact copy
// once it runs, so writing it here once, straight onto the static elements design-5.html
// already ships, costs nothing and never races a figure's own paint.
const paintBootLoading = () => {
  const status = document.getElementById('status')
  if (status) status.textContent = 'Carregando a base local…'
  const viewport = document.getElementById('viewport')
  if (viewport) viewport.innerHTML = '<div class="empty">Carregando o campo de palavras…</div>'
  const testimonyList = document.getElementById('testimonyList')
  if (testimonyList) testimonyList.textContent = 'Carregando…'
  const compareDetail = document.getElementById('compareDetail')
  if (compareDetail) compareDetail.innerHTML = '<span class="empty-hint">Carregando a régua…</span>'
}

export const boot = async () => {
  paintBootLoading()
  /** @type {Person[]} */
  let people = []
  /** @type {unknown} */
  let peopleError = null
  try {
    people = await loadPeople()
  } catch (e) {
    peopleError = e
  }
  for (const figure of FIGURES) {
    const root = document.getElementById(figure.sectionId)
    if (!root) continue
    // Each figure mounts on its own: one figure throwing must never stop the others from
    // reaching the reader, which is the whole point of splitting them (issue #92).
    try {
      figure.mount(root, { people, initial: seedFor(figure.id, figure.keys, location.search), peopleError })
    } catch (err) {
      console.error(`figure "${figure.id}" failed to mount`, err)
      // Without this the figure sits on paintBootLoading()'s "Carregando…" forever, which
      // reads as a slow network rather than as the failure it is.
      const notice = document.getElementById(figure.noticeId)
      if (notice) notice.textContent = 'Esta figura falhou ao carregar.'
    }
  }
}

if (typeof document !== 'undefined') boot()
