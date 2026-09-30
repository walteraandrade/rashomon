import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Ruler from '../../src/ui/Ruler.svelte'

const word = (term: string, kind = 'word') => ({ term, kind, text: term, x: 100, y: 0, size: 14, w: 60, h: 17, cmp: 'var(--cmp-a)', bridge: false, aria: `${term}, 5 documentos`, title: `${term} · 5 documentos` })
const spilled = (term: string, kind = 'word') => ({ term, kind, text: term, cmp: 'var(--cmp-b)' })

let target: HTMLElement
let instance: ReturnType<typeof mount> | undefined

const render = (props: Record<string, unknown> = {}) => {
  target = document.createElement('div')
  document.body.append(target)
  const onpick = vi.fn()
  instance = mount(Ruler, {
    target,
    props: {
      width: 400,
      height: 80,
      half: 40,
      x0: 28,
      x1: 372,
      ticks: [28, 200, 372],
      endA: 'Lula',
      endB: 'Bolsonaro',
      axisLabels: ['Só de Lula', 'dividida', 'Só de Bolsonaro'],
      ariaLabel: 'Régua',
      note: 'nota',
      words: [word('reforma'), word('golpe', 'hashtag')],
      overflow: [spilled('pix')],
      overflowIntro: '1 palavra não coube',
      selected: null,
      onpick,
      ...props,
    },
  })
  flushSync()
  return onpick
}

afterEach(() => {
  if (instance) unmount(instance)
  instance = undefined
  document.body.innerHTML = ''
})

describe('Ruler', () => {
  it('draws one .ruler-word per word with the hooks and the accessible label', () => {
    render()
    const words = [...target.querySelectorAll('.ruler-word')]
    expect(words).toHaveLength(2)
    expect(words[0].getAttribute('data-term')).toBe('reforma')
    expect(words[1].getAttribute('data-kind')).toBe('hashtag')
    expect(words[0].getAttribute('aria-pressed')).toBe('false')
    expect(words[0].getAttribute('aria-label')).toBe('reforma, 5 documentos')
    expect(target.querySelector('.ruler-end.cmp-a')?.textContent).toBe('Lula')
    expect(target.querySelector('.ruler-axis-labels')?.textContent).toBe(['Só de Lula', 'dividida', 'Só de Bolsonaro'].join(''))
  })

  it('lists overflow words as buttons with the same hooks', () => {
    render()
    const buttons = [...target.querySelectorAll('.ruler-overflow button')]
    expect(buttons).toHaveLength(1)
    expect(buttons[0].getAttribute('data-term')).toBe('pix')
    expect(buttons[0].getAttribute('data-kind')).toBe('word')
    expect(target.querySelector('.ruler-overflow p')?.textContent).toBe('1 palavra não coube')
  })

  it('carries size and side colour as style custom properties, never a font-size', () => {
    render()
    const style = target.querySelector('.ruler-word')?.getAttribute('style') ?? ''
    expect(style).toContain('--size: 14px')
    expect(style).toContain('--cmp: var(--cmp-a)')
    expect(style).not.toMatch(/font-size/)
    expect(target.querySelector('.ruler-overflow button')?.getAttribute('style')).toContain('--cmp')
  })

  it('reflects the selection in aria-pressed on words and overflow buttons', () => {
    render({ selected: { term: 'reforma', kind: 'word' } })
    expect(target.querySelector('.ruler-word')?.getAttribute('aria-pressed')).toBe('true')
    expect(target.querySelector('.ruler-word')?.classList.contains('is-selected')).toBe(true)
    expect(target.querySelectorAll('.ruler-word')[1].getAttribute('aria-pressed')).toBe('false')
    unmount(instance!)
    document.body.innerHTML = ''
    render({ selected: { term: 'pix', kind: 'word' } })
    expect(target.querySelector('.ruler-overflow button')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('calls onpick on click, and on Enter and Space with the default prevented', () => {
    const onpick = render()
    const first = target.querySelector('.ruler-word')!
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (const key of ['Enter', ' ']) {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      first.dispatchEvent(e)
      expect(e.defaultPrevented).toBe(true)
    }
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    first.dispatchEvent(other)
    expect(other.defaultPrevented).toBe(false)
    target.querySelector('.ruler-overflow button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onpick.mock.calls).toEqual([['reforma', 'word'], ['reforma', 'word'], ['reforma', 'word'], ['pix', 'word']])
  })

  it('marks a bridge word', () => {
    render({ words: [{ ...word('stf'), bridge: true }] })
    expect(target.querySelector('.ruler-bridge')?.getAttribute('data-term')).toBe('stf')
    expect(target.querySelector('.ruler-bridge-mark')).not.toBeNull()
  })
})
