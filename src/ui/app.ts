import { mountDocsCard } from './docs-card.js'
import { mountHelp } from './help.js'
import * as api from './api.js'
import { setBoot, type Person } from './boot.svelte.js'

const loadPeople = (): Promise<Person[]> => api.loadPeople()

export const boot = async () => {
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
}
