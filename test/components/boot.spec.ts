import { describe, expect, it } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import BootProbe from './BootProbe.svelte'
import { setBoot } from '../../src/ui/boot.svelte.js'

describe('bootData', () => {
  it('a component reading it re-renders after setBoot', () => {
    const target = document.createElement('div')
    document.body.append(target)
    const instance = mount(BootProbe, { target })
    flushSync()
    expect(target.textContent).toBe('waiting')
    setBoot({ people: [{ id: 'p1', name: 'Ana' }], ready: true, search: '?days=7' })
    flushSync()
    expect(target.textContent).toBe('ready Ana ?days=7')
    setBoot({ peopleError: new Error('x') })
    flushSync()
    expect(target.textContent).toContain('error')
    unmount(instance)
    target.remove()
  })
})
