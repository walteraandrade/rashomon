import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Compare from '../../src/ui/Compare.svelte'

describe('Compare on the server', () => {
  it('Compare renders on the server with both sentence variants', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined()
    const { body } = render(Compare)
    for (const id of ['compareMode', 'compareLensAInput', 'compareLensAList', 'compareLensBInput', 'compareLensBList']) expect(body).toContain(`id="${id}"`)
    expect(body).toMatch(/<span hidden=""><span class="pick"><select id="comparePerson"/)
    expect(body).toMatch(/<span><span class="pick"><select id="compareA"/)
  })
})
