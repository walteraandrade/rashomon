// The page's shell: fetches the person list exactly once, then mounts every figure onto its
// own section, handing each one that list plus the slice of the querystring it seeded on. Each
// figure owns its own controls, its own fetches and its own state from here on (see
// src/ui/figures/atlas.ts, testimony.ts and compare.ts); nothing here reaches back
// into a figure's DOM once it is mounted, and no figure imports another. Importing this module
// is side-effect free outside a browser: boot() runs only when a `document` exists, which is
// what lets node:test import the pieces below.

import { mountDocsCard } from './docs-card.js'
import { mount as mountAtlas } from './figures/atlas.js'
import { mount as mountCompare } from './figures/compare.js'
import { mount as mountTestimony } from './figures/testimony.js'

type Person = { id: string; name: string }
// A plain key reads the same-named bare querystring param as its fallback (`days` falls back to
// `?days=`); a `[key, bareKey | null]` pair names a different bare fallback (figure 3's `a`
// falls back to the page-wide `?person=`) or none at all (`null`, for a key with no bare
// equivalent, like figure 3's `b` and `measure` -- issue #91 §2).
type SeedKey = string | [string, string | null]

type Seed = Record<string, string | undefined>

// The section element a figure mounts into: only `classList` is ever touched, which is what
// lets the suites mount a figure against a DOM stand-in (see each figure's own FigureRoot).
type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

// Every figure mounts through the same door: a section element plus the person list, the seed
// it read off the querystring and whatever GET /api/people rejected with. Each figure narrows
// `initial` to its own keys, which is why the shell hands it over untyped.
type FigureEntry = {
  id: string
  sectionId: string
  keys: SeedKey[]
  noticeId: string
  mount: (root: FigureRoot, args: { people: Person[]; initial: any; peopleError?: unknown }) => void
}

// One entry per figure: the section it mounts into, the client-side querystring keys it reads
// (bare, or prefixed with its own id) and the mount function it owns end to end. Order is the
// mount order, which is also the order app.ts's shell runs in — figure 1, then figure 2, then
// figure 3. `noticeId` is the element each figure's own loading copy lands on, so the shell can
// replace that copy when the figure never gets far enough to repaint it itself.
const FIGURES: FigureEntry[] = [
  { id: 'atlas', sectionId: 'workspace', keys: ['person', 'days', 'source', 'sort', 'limit'], noticeId: 'status', mount: mountAtlas },
  { id: 'testimony', sectionId: 'testimony', keys: ['person', 'days', 'source'], noticeId: 'testimonyList', mount: mountTestimony },
  {
    id: 'compare',
    sectionId: 'compare',
    keys: [['a', 'person'], ['b', null], 'days', 'source', 'limit', ['measure', null]],
    noticeId: 'compareDetail',
    mount: mountCompare,
  },
]

// A prefixed value (`atlas.days=`) overrides the bare one (`days=`) for that figure only; a
// key with neither is left undefined, so the figure's own applySeed/resolvePerson decide the
// default exactly as if no querystring were there at all. Read-only: nothing here ever writes
// back to location/history.
const seedFor = (figureId: string, keys: SeedKey[], search: string): Seed => {
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

// Not routed through api.ts on purpose: the shell mounts figures, nothing else, and api.ts
// is each figure's own dependency (test/atlas-modules-acceptance.test.ts's import graph keeps
// app.ts's own imports down to the figures it mounts).
const loadPeople = async (): Promise<Person[]> => {
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
  let people: Person[] = []
  let peopleError: unknown = null
  try {
    people = await loadPeople()
  } catch (e) {
    peopleError = e
  }
  // The documents card belongs to no figure -- all three open it -- so the shell wires it once,
  // before any of them can ask for it.
  mountDocsCard()
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
