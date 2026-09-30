// The boot data every figure component reads: the tracked people, whether loading them has
// settled, and the page's querystring. app.ts's boot() writes it; components only read.
// Reactivity comes from createSubscriber, not a rune, so the plain node:test suites that
// import app.ts still load this module.

import { createSubscriber } from 'svelte/reactivity'

export type Person = { id: string; name: string }

type Boot = { ready: boolean; people: Person[]; peopleError: unknown; search: string }

const store: Boot = { ready: false, people: [], peopleError: null, search: '' }
let bump = () => {}
const subscribe = createSubscriber((update) => {
  bump = update
  return () => {
    bump = () => {}
  }
})

export const setBoot = (patch: Partial<Boot>) => {
  Object.assign(store, patch)
  bump()
}

export const bootData: Readonly<Boot> = {
  get ready() {
    subscribe()
    return store.ready
  },
  get people() {
    subscribe()
    return store.people
  },
  get peopleError() {
    subscribe()
    return store.peopleError
  },
  get search() {
    subscribe()
    return store.search
  },
}
