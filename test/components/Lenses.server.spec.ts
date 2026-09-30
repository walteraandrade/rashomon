import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Lenses from '../../src/ui/Lenses.svelte'

describe('Lenses on the server', () => {
  it('prerenders both lens comboboxes, so the picks are not empty before hydration', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined()
    const { body } = render(Lenses)
    for (const id of ['lensesAInput', 'lensesAList', 'lensesBInput', 'lensesBList']) expect(body).toContain(`id="${id}"`)
  })
})
