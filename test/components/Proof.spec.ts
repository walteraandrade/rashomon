import { afterEach, describe, expect, it } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Proof from '../../src/ui/Proof.svelte'

let target: HTMLElement
let instance: ReturnType<typeof mount> | undefined

const setup = () => {
  target = document.createElement('div')
  document.body.appendChild(target)
  instance = mount(Proof, { target })
  flushSync()
  return {
    button: target.querySelector('button') as HTMLButtonElement,
    p: target.querySelector('p') as HTMLParagraphElement,
  }
}

afterEach(() => {
  if (instance) unmount(instance)
  instance = undefined
  target?.remove()
})

describe('Proof', () => {
  it('click increments after flushSync', () => {
    const { button, p } = setup()
    expect(p.textContent).toBe('Cliques: 0')
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(p.textContent).toBe('Cliques: 1')
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(p.textContent).toBe('Cliques: 2')
  })

  it('effect sets data-parity', () => {
    const { button, p } = setup()
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(p.getAttribute('data-parity')).toBe('impar')
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(p.getAttribute('data-parity')).toBe('par')
  })

  it('click goes through delegation', () => {
    const { button, p } = setup()
    expect(button.onclick).toBeNull()
    button.dispatchEvent(new MouseEvent('click', { bubbles: false }))
    flushSync()
    expect(p.textContent).toBe('Cliques: 0')
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(p.textContent).toBe('Cliques: 1')
  })
})
