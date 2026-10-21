import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Comention from '../../src/ui/Comention.svelte'

describe('Comention on the server', () => {
  it('renders without document with the section, the person select and neither the grid nor the toggle', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined()
    const { body } = render(Comention)
    expect(body).toContain('id="comention"')
    expect(body).toMatch(/<select[^>]*id="comentionPerson"/)
    expect(body).toContain('todas as pessoas')
    expect(body).toMatch(/<figure[^>]*id="comentionMatrix"[^>]*hidden|<figure[^>]*hidden[^>]*id="comentionMatrix"/)
    expect(body).not.toContain('comention-grid')
    expect(body).not.toContain('comentionToggle')
  })
})
