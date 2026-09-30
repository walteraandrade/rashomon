import { mountDocsCard } from './docs-card.js'
import { mount as mountAgenda } from './figures/agenda.js'
import { mount as mountAttention } from './figures/attention.js'
import { mount as mountAtlas } from './figures/atlas.js'
import { mount as mountComention } from './figures/comention.js'
import { mount as mountCompare } from './figures/compare.js'
import { mount as mountLenses } from './figures/lenses.js'
import { mount as mountPersistence } from './figures/persistence.js'
import { mount as mountRising } from './figures/rising.js'
import { mount as mountTestimony } from './figures/testimony.js'
import { mount as mountWeek } from './figures/week.js'
import { mountHelp } from './help.js'
import {
  paintAgendaLoading,
  paintAtlasLoading,
  paintAttentionLoading,
  paintComentionLoading,
  paintCompareLoading,
  paintLensesLoading,
  paintOutletsLoading,
  paintPersistenceLoading,
  paintRisingLoading,
  paintTestimonyLoading,
  paintWeekLoading,
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
  { id: 'testimony', sectionId: 'testimony', keys: ['person', 'days', 'source'], noticeId: 'testimonyList', mount: mountTestimony },
  {
    id: 'compare',
    sectionId: 'compare',
    keys: [['a', 'person'], ['b', null], 'days', 'source', 'limit', ['measure', null]],
    noticeId: 'compareDetail',
    mount: mountCompare,
  },
  { id: 'rising', sectionId: 'rising', keys: ['person', 'source'], noticeId: 'risingAbout', mount: mountRising },
  // days stays fixed at 7, never seeded: figure 5 has no period control (issue #147 §4).
  { id: 'week', sectionId: 'week', keys: ['person', 'source', 'limit'], noticeId: 'weekNote', mount: mountWeek },
  { id: 'lenses', sectionId: 'lenses', keys: ['person', ['a', null], ['b', null], 'days', 'limit'], noticeId: 'lensesDetail', mount: mountLenses },
  // days stays fixed at 30, never seeded: figure 7 has no period control, like week's fixed 7.
  { id: 'attention', sectionId: 'attention', keys: ['person', 'source'], noticeId: 'attentionNote', mount: mountAttention },
  // Spans every tracked person at once, so no 'person' key: the route's own persons list feeds
  // the grid's columns.
  { id: 'agenda', sectionId: 'agenda', keys: ['days', 'source'], noticeId: 'agendaGrid', mount: mountAgenda },
  // Spans every tracked person, so there is no `person` key here.
  { id: 'comention', sectionId: 'comention', keys: ['days', 'source', ['lean', null], ['min', null]], noticeId: 'comentionAbout', mount: mountComention },
  // `weeks` is prefixed only: no other figure has a weeks control, so a bare weeks= means nothing here.
  { id: 'persistence', sectionId: 'persistence', keys: ['person', ['weeks', null], 'limit'], noticeId: 'persistenceNote', mount: mountPersistence },
]

const loadPeople = (): Promise<Person[]> => api.loadPeople()

const paintBootLoading = () => {
  const status = document.getElementById('status')
  if (status) status.textContent = 'Lendo as pessoas.'
  paintAtlasLoading()
  paintTestimonyLoading()
  paintOutletsLoading()
  paintCompareLoading()
  paintRisingLoading()
  paintWeekLoading()
  paintLensesLoading()
  paintAttentionLoading()
  paintAgendaLoading()
  paintComentionLoading()
  paintPersistenceLoading()
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
