// The page's shell: fetches the person list exactly once, then mounts every figure onto its
// own section, handing each one that list plus the slice of the querystring it seeded on. Each
// figure owns its own controls, its own fetches and its own state from here on (see
// public/js/figures/atlas.js and public/js/figures/testimony.js); nothing here reaches back
// into a figure's DOM once it is mounted, and no figure imports another. Importing this module
// is side-effect free outside a browser: boot() runs only when a `document` exists, which is
// what lets node:test import the pieces below.

import { mount as mountAtlas } from './figures/atlas.js'
import { mount as mountTestimony } from './figures/testimony.js'

/** @typedef {{ id: string, name: string }} Person */

// One entry per figure: the section it mounts into, the client-side querystring keys it reads
// (bare, or prefixed with its own id) and the mount function it owns end to end. Order is the
// mount order, which is also the order app.js's shell runs in — first figure 1, then figure 2.
const FIGURES = [
  { id: 'atlas', sectionId: 'workspace', keys: ['person', 'days', 'source', 'sort', 'limit'], mount: mountAtlas },
  { id: 'testimony', sectionId: 'testimony', keys: ['person', 'days', 'source'], mount: mountTestimony },
]

// A prefixed value (`atlas.days=`) overrides the bare one (`days=`) for that figure only; a
// key with neither is left undefined, so the figure's own applySeed/resolvePerson decide the
// default exactly as if no querystring were there at all. Read-only: nothing here ever writes
// back to location/history.
/**
 * @param {string} figureId
 * @param {string[]} keys
 * @param {string} search
 */
const seedFor = (figureId, keys, search) => {
  const params = new URLSearchParams(search)
  return Object.fromEntries(keys.map((key) => [key, params.get(`${figureId}.${key}`) ?? params.get(key) ?? undefined]))
}

// Not routed through api.js on purpose: the shell mounts figures, nothing else, and api.js
// is each figure's own dependency (test/atlas-modules-acceptance.test.ts's import graph keeps
// app.js's own imports down to the two figures it mounts).
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
    // Each figure mounts on its own: one figure throwing must never stop the other from
    // reaching the reader, which is the whole point of splitting them (issue #92).
    try {
      figure.mount(root, { people, initial: seedFor(figure.id, figure.keys, location.search), peopleError })
    } catch (err) {
      console.error(`figure "${figure.id}" failed to mount`, err)
    }
  }
}

if (typeof document !== 'undefined') boot()
