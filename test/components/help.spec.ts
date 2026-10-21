import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import HelpDialog from '../../src/ui/HelpDialog.svelte'
import { closeHelp, openHelp } from '../../src/ui/help.svelte.js'

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
    <a id="other" href="/outra#pmi">g</a>
    <a id="bare" href="/como-ler">h</a>
    <a id="altaLink" href="como-ler.html#em-alta">i</a>
    <a id="semanaLink" href="como-ler.html#semana">j</a>
    <a id="sobre" href="/sobre">k</a>`
  document.body.append(target, links)
  instance = mount(HelpDialog, { target })
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

  it('intercepts a bare /como-ler with no section', () => {
    const event = click('bare')
    expect(event.defaultPrevented).toBe(true)
    expect(dialog().open).toBe(true)
    expect(scrolled).toEqual([])
  })

  it('resolves como-ler.html#em-alta and #semana', () => {
    expect(click('altaLink').defaultPrevented).toBe(true)
    expect(scrolled).toEqual(['help-em-alta'])
    closeHelp()
    scrolled.length = 0
    expect(click('semanaLink').defaultPrevented).toBe(true)
    expect(dialog().open).toBe(true)
    expect(scrolled).toEqual(['help-semana'])
  })

  it('other pages are not the guide', () => {
    expect(click('sobre').defaultPrevented).toBe(false)
    expect(dialog().open).toBe(false)
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

  it('fires once per click', () => {
    const modal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    click('abs')
    expect(modal).toHaveBeenCalledTimes(1)
    expect(scrolled).toEqual(['help-pmi'])
  })

  it('opens at help-comparar from a #comparar link', () => {
    const a = document.createElement('a')
    a.id = 'comparar-link'
    a.href = '/como-ler#comparar'
    links.append(a)
    expect(document.getElementById('help-comparar')).not.toBeNull()
    const event = click('comparar-link')
    expect(event.defaultPrevented).toBe(true)
    expect(dialog().open).toBe(true)
    expect(scrolled).toEqual(['help-comparar'])
  })

  it('keeps the ids the page and the links rely on', () => {
    for (const id of ['helpDialog', 'helpTitle', 'helpClose', 'help-pmi', 'help-atlas', 'help-analise']) expect(document.getElementById(id), id).not.toBeNull()
  })

  it('names no 30- or 60-day window, and says 14 dias antes for the rising baseline (issue #313 AC28)', () => {
    const text = dialog().textContent ?? ''
    expect(text).not.toMatch(/\b(30|60) dias\b/)
    expect(text).toContain('14 dias antes')
  })

  it('the avaliação section states the ranked-dots facts and keeps "mesma régua" off the atlas mode (issue #331)', () => {
    const section = document.getElementById('help-avaliacao')!.textContent ?? ''
    expect(section).toMatch(/20 com mais textos avaliados/)
    expect(section).toMatch(/de −5 a \+5/)
    expect(section).toMatch(/além disso é desenhada na borda, com uma seta/)
    expect(section).toMatch(/linha vertical[^.]*média da pessoa/)
    expect(section).toMatch(/3 ou mais textos avaliados/)
    expect(section).toMatch(/modo Avaliação usa a mesma nota do kikori/)
    expect(section).not.toContain('mesma régua')
    expect(section).not.toContain('o tamanho é quantos textos')
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
    unmount(other)
    for (const [type, fn] of adds) expect(removes.some(([t, f]) => t === type && f === fn), `${type} listener left behind`).toBe(true)
    expect(document.getElementById('helpDialog')).toBeNull()
  })
})
