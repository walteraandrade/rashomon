import { mountDocsCard } from './docs-card.js'
import { mount as mountAtlas } from './figures/atlas.js'
import { mount as mountLenses } from './figures/lenses.js'
import { mount as mountRising } from './figures/rising.js'
import { mountHelp } from './help.js'
import {
  paintAtlasLoading,
  paintLensesLoading,
  paintRisingLoading,
} from './render.js'
import * as api from './api.js'
import { setBoot, type Person } from './boot.svelte.js'
import { seedFor, type SeedKey } from './seed.js'

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
  { id: 'rising', sectionId: 'rising', keys: ['person', 'source'], noticeId: 'risingAbout', mount: mountRising },
  { id: 'lenses', sectionId: 'lenses', keys: ['person', ['a', null], ['b', null], 'days', 'limit'], noticeId: 'lensesDetail', mount: mountLenses },
]

const loadPeople = (): Promise<Person[]> => api.loadPeople()

const paintBootLoading = () => {
  const status = document.getElementById('status')
  if (status) status.textContent = 'Lendo as pessoas.'
  paintAtlasLoading()
  paintRisingLoading()
  paintLensesLoading()
}

export const boot = async () => {
  paintBootLoading()
  setBoot({ search: location.search })
  let people: Person[] = []
  let peopleError: unknown = null
  try {
    people = await loadPeople()
  } catch (e) {
    peopleError = e
  }
  setBoot({ people, peopleError, ready: true })
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
