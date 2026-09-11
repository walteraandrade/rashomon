import { mountDocsCard } from './docs-card.js'
import { mount as mountAtlas } from './figures/atlas.js'
import { mount as mountCompare } from './figures/compare.js'
import { mount as mountTestimony } from './figures/testimony.js'
import { mount as mountWeek } from './figures/week.js'
import { mountHelp } from './help.js'
import { paintAtlasLoading, paintCompareLoading, paintOutletsLoading, paintTestimonyLoading, paintWeekLoading } from './render.js'

type Person = { id: string; name: string }
// A `[key, bareKey | null]` pair names a different bare fallback or none (null).
type SeedKey = string | [string, string | null]

type Seed = Record<string, string | undefined>

type FigureRoot = { classList: { add: (name: string) => void; remove: (name: string) => void } }

type FigureEntry = {
  id: string
  sectionId: string
  keys: SeedKey[]
  noticeId: string
  mount: (root: FigureRoot, args: { people: Person[]; initial: any; peopleError?: unknown }) => void
}

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
  { id: 'week', sectionId: 'week', keys: ['person', 'source', 'limit'], noticeId: 'weekChart', mount: mountWeek },
]

// A prefixed value (`atlas.days=`) overrides the bare one (`days=`) for that figure only.
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

const loadPeople = async (): Promise<Person[]> => {
  const res = await fetch('/api/people')
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

const paintBootLoading = () => {
  const status = document.getElementById('status')
  if (status) status.textContent = 'Lendo as pessoas.'
  paintAtlasLoading()
  paintTestimonyLoading()
  paintOutletsLoading()
  paintCompareLoading()
  paintWeekLoading()
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
  // The documents card and the guide belong to no figure, so the shell wires both once.
  mountDocsCard()
  mountHelp()
  for (const figure of FIGURES) {
    const root = document.getElementById(figure.sectionId)
    if (!root) continue
    try {
      figure.mount(root, { people, initial: seedFor(figure.id, figure.keys, location.search), peopleError })
    } catch (err) {
      console.error(`figure "${figure.id}" failed to mount`, err)
      // A mount failure must not leave the loading ghost on screen.
      const notice = document.getElementById(figure.noticeId)
      if (notice) notice.textContent = 'Esta figura falhou ao carregar.'
    }
  }
}

if (typeof document !== 'undefined') boot()
