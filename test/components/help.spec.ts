import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import HelpDialog from '../../src/ui/HelpDialog.svelte'
import { closeHelp, mountHelp, openHelp } from '../../src/ui/help.svelte.js'

let target: HTMLElement
let links: HTMLElement
let instance: ReturnType<typeof mount> | undefined
let scrolled: string[]

const dialog = () => document.getElementById('helpDialog') as HTMLDialogElement

beforeEach(() => {
  scrolled = []
  ;(Element.prototype as any).scrollIntoView = function () {
    scrolled.push((this as Element).id)
  }
  target = document.createElement('div')
  links = document.createElement('div')
  links.innerHTML = `
    <a id="abs" href="/como-ler#pmi">a</a>
    <a id="rel" href="como-ler.html#pmi">b</a>
    <a id="full" href="https://x.test/como-ler.html#atlas">c</a>
    <a id="blank" href="/como-ler#pmi" target="_blank">d</a>
    <a id="leave" href="/como-ler#pmi" data-leave>e</a>
    <a id="unknown" href="/como-ler#nao-existe">f</a>
    <a id="other" href="/outra#pmi">g</a>`
  document.body.append(target, links)
  instance = mount(HelpDialog, { target })
  mountHelp()
  flushSync()
})

afterEach(() => {
  closeHelp()
  if (instance) unmount(instance)
  instance = undefined
  target.remove()
  links.remove()
  vi.restoreAllMocks()
})

const click = (id: string, init: MouseEventInit = {}) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
  document.getElementById(id)!.dispatchEvent(event)
  flushSync()
  return event
}

describe('HelpDialog', () => {
  it('intercepts /como-ler#x and como-ler.html#x', () => {
    for (const id of ['abs', 'rel', 'full']) {
      closeHelp()
      scrolled.length = 0
      const event = click(id)
      expect(event.defaultPrevented, id).toBe(true)
      expect(dialog().open, id).toBe(true)
      expect(scrolled.length, id).toBe(1)
    }
    closeHelp()
    scrolled.length = 0
    click('abs')
    expect(scrolled).toEqual(['help-pmi'])
  })

  it('leaves modifier click, target blank and data-leave alone', () => {
    const cases: [string, MouseEventInit][] = [
      ['abs', { ctrlKey: true }],
      ['abs', { metaKey: true }],
      ['abs', { shiftKey: true }],
      ['abs', { altKey: true }],
      ['abs', { button: 1 }],
      ['blank', {}],
      ['leave', {}],
      ['other', {}],
    ]
    for (const [id, init] of cases) {
      const event = click(id, init)
      expect(event.defaultPrevented, `${id} ${JSON.stringify(init)}`).toBe(false)
      expect(dialog().open).toBe(false)
    }
  })

  it('unknown hash opens at top', () => {
    expect(() => openHelp('#unknown')).not.toThrow()
    flushSync()
    expect(dialog().open).toBe(true)
    expect(scrolled).toEqual([])
    closeHelp()
    flushSync()
    click('unknown')
    expect(dialog().open).toBe(true)
  })

  it('fires once when mountHelp is also called', () => {
    mountHelp()
    mountHelp()
    const modal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    click('abs')
    expect(modal).toHaveBeenCalledTimes(1)
    expect(scrolled).toEqual(['help-pmi'])
  })

  it('keeps the ids the page and the links rely on', () => {
    for (const id of ['helpDialog', 'helpTitle', 'helpClose', 'help-pmi', 'help-atlas', 'help-analise']) expect(document.getElementById(id), id).not.toBeNull()
  })

  it('closeHelp closes', () => {
    openHelp('#pmi')
    flushSync()
    expect(dialog().open).toBe(true)
    closeHelp()
    flushSync()
    expect(dialog().open).toBe(false)
  })

  it('leaves no listener behind on unmount', () => {
    const adds: [string, unknown][] = []
    const removes: [string, unknown][] = []
    const add = document.addEventListener.bind(document)
    const rem = document.removeEventListener.bind(document)
    vi.spyOn(document, 'addEventListener').mockImplementation(((t: string, f: unknown, o?: unknown) => (adds.push([t, f]), add(t, f as any, o as any))) as any)
    vi.spyOn(document, 'removeEventListener').mockImplementation(((t: string, f: unknown, o?: unknown) => (removes.push([t, f]), rem(t, f as any, o as any))) as any)
    unmount(instance!)
    instance = undefined
    const other = mount(HelpDialog, { target })
    mountHelp()
    unmount(other)
    for (const [type, fn] of adds) expect(removes.some(([t, f]) => t === type && f === fn), `${type} listener left behind`).toBe(true)
    expect(document.getElementById('helpDialog')).toBeNull()
  })
})
