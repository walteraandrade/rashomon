import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Persistence from '../../src/ui/Persistence.svelte'

describe('Persistence on the server', () => {
  it('AC13: renders without document with the section, a hidden chart and the three selects', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined()
    const { body } = render(Persistence)
    expect(body).toContain('id="persistence"')
    expect(body).toMatch(/<figure[^>]*id="persistenceChart"[^>]*hidden|<figure[^>]*hidden[^>]*id="persistenceChart"/)
    for (const id of ['persistencePerson', 'persistenceWeeks', 'persistenceLimit']) expect(body).toMatch(new RegExp(`<select[^>]*id="${id}"`))
  })
})
