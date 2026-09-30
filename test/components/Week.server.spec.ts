import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Week from '../../src/ui/Week.svelte'

describe('Week on the server', () => {
  it('renders without document, with the section and #weekChart hidden', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined()
    const { body } = render(Week)
    expect(body).toMatch(/<section[^>]*id="week"/)
    expect(body).toMatch(/<figure[^>]*id="weekChart"[^>]*\bhidden(=""|[ >])|<figure[^>]*\bhidden(=""|[ >])[^>]*id="weekChart"/)
    expect(body).toContain('id="weekNote"')
  })
})
