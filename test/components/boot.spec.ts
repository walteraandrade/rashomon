import { describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Page from '../../web/routes/+page.svelte'
import BootProbe from './BootProbe.svelte'
import { bootData, setBoot } from '../../src/ui/boot.svelte.js'

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

describe('#298 page boot', () => {
  const load = async (people: () => Response | Promise<Response>) => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (/\/api\/people(\?|$)/.test(url)) return people()
      return new Response('unavailable', { status: 503 })
    })
    setBoot({ people: [], peopleError: null, ready: false, search: '' })
    const target = document.createElement('div')
    document.body.append(target)
    const instance = mount(Page, { target })
    await vi.waitFor(() => expect(bootData.ready).toBe(true))
    return { bootData, calls, cleanup: () => { unmount(instance); target.remove(); vi.unstubAllGlobals() } }
  }
  const peopleCalls = (calls: string[]) => calls.filter((u) => /\/api\/people(\?|$)/.test(u))

  it('boot sets ready after a successful people fetch', async () => {
    const { bootData, calls, cleanup } = await load(() => new Response(JSON.stringify([{ id: 'p1', name: 'Ana' }]), { status: 200, headers: { 'content-type': 'application/json' } }))
    expect(bootData.people.map((p) => p.name)).toEqual(['Ana'])
    expect(bootData.peopleError).toBeNull()
    expect(peopleCalls(calls)).toHaveLength(1)
    cleanup()
  })

  it('boot sets ready and peopleError after a failed people fetch', async () => {
    const { bootData, calls, cleanup } = await load(() => new Response('nope', { status: 500 }))
    expect(bootData.ready).toBe(true)
    expect(bootData.peopleError).not.toBeNull()
    expect(peopleCalls(calls)).toHaveLength(1)
    cleanup()
  })
})

describe('#298 page boot seeds the querystring', () => {
  it('publishes location.search as bootData.search before ready', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
      /\/api\/people(\?|$)/.test(String(input)) ? new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('x', { status: 503 }))
    history.replaceState(null, '', '/?days=7&compare.b=p2')
    setBoot({ people: [], peopleError: null, ready: false, search: '' })
    const target = document.createElement('div')
    document.body.append(target)
    const instance = mount(Page, { target })
    await vi.waitFor(() => expect(bootData.ready).toBe(true))
    expect(bootData.search).toBe('?days=7&compare.b=p2')
    unmount(instance); target.remove(); vi.unstubAllGlobals(); history.replaceState(null, '', '/')
  })
})
