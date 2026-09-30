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
    for (const id of ['viewport', 'columns', 'atlasStrip', 'inspector', 'keyDefault', 'keyTheme', 'keyStrip', 'atlasStats'])
      expect(body, `#${id}`).toMatch(new RegExp(`id="${id}"`))
  })
  it('the prerendered viewport holding the ghost is hidden until the component mounts', () => {
    const { body } = render(Atlas)
    expect(body).toMatch(/<div class="viewport" id="viewport"[^>]*\shidden/)
  })
})
