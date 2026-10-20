import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
// @ts-ignore -- the component is what issue #297 adds
import Atlas from '../../src/ui/Atlas.svelte'

describe('Atlas on the server (issue #297)', () => {
  it('atlas AC13: server-renders #workspace without document, window or location', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined()
    expect((globalThis as { window?: unknown }).window).toBeUndefined()
    expect((globalThis as { location?: unknown }).location).toBeUndefined()
    const { body } = render(Atlas)
    expect(body).toMatch(/<section[^>]*id="workspace"/)
    expect(body).toMatch(/<[^>]*id="selectionNote"/)
    for (const id of ['columns', 'scatter', 'atlasStrip', 'inspector', 'keyDefault', 'keyScatter', 'keyTheme', 'keyStrip', 'atlasStats'])
      expect(body, `#${id}`).toMatch(new RegExp(`id="${id}"`))
    expect(body).not.toMatch(/id="viewport"/)
  })
  it('the prerendered list holding the ghost is hidden until the component mounts, and the scatter and strip stay hidden', () => {
    const { body } = render(Atlas)
    expect(body).toMatch(/<div[^>]*\bid="columns"[^>]*\shidden/)
    expect(body).toMatch(/<figure[^>]*\bid="scatter"[^>]*\shidden/)
    expect(body).toMatch(/<figure[^>]*\bid="atlasStrip"[^>]*\shidden/)
    expect(body).not.toMatch(/data-node=/)
  })
})
