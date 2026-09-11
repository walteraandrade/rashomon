import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { closeHelp, mountHelp, openHelp } from '../src/ui/help.js'

type Link = {
  getAttribute: (name: string) => string | null
  hasAttribute: (name: string) => boolean
}

type ClickEvent = {
  defaultPrevented: boolean
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  target: { closest: (selector: string) => Link | null }
  preventDefault: () => void
}

const withHelpDom = <T>(
  fn: (ctx: {
    dialog: { open: boolean; showModal: () => void; close: () => void }
    listeners: { type: string; fn: (e: ClickEvent) => void }[]
    scrolled: string[]
  }) => T,
): T => {
  const dialog = {
    open: false,
    showModal() {
      this.open = true
    },
    close() {
      this.open = false
    },
    addEventListener() {},
  }
  const helpClose = { addEventListener() {} }
  const scrolled: string[] = []
  const listeners: { type: string; fn: (e: ClickEvent) => void }[] = []
  const previous = (globalThis as { document?: unknown }).document
  ;(globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => {
      if (id === 'helpDialog') return dialog
      if (id === 'helpClose') return helpClose
      if (id.startsWith('help-'))
        return {
          scrollIntoView: () => {
            scrolled.push(id)
          },
        }
      return null
    },
    addEventListener: (type: string, fn: (e: ClickEvent) => void) => {
      listeners.push({ type, fn })
    },
  }
  try {
    return fn({ dialog, listeners, scrolled })
  } finally {
    ;(globalThis as { document?: unknown }).document = previous
  }
}

const fire = (
  fn: (e: ClickEvent) => void,
  href: string,
  opts: { metaKey?: boolean; target?: string | null; dataLeave?: boolean } = {},
) => {
  const link: Link = {
    getAttribute: (name) => {
      if (name === 'href') return href
      if (name === 'target') return opts.target ?? null
      return null
    },
    hasAttribute: (name) => name === 'data-leave' && !!opts.dataLeave,
  }
  const event: ClickEvent = {
    defaultPrevented: false,
    button: 0,
    metaKey: !!opts.metaKey,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: { closest: (selector) => (selector === 'a[href]' ? link : null) },
    preventDefault() {
      event.defaultPrevented = true
    },
  }
  fn(event)
  return event
}

describe('help.ts: como-ler.html clicks stay on the atlas', () => {
  it('a plain click on como-ler.html#atlas opens the dialog at that section', () => {
    withHelpDom(({ dialog, listeners, scrolled }) => {
      mountHelp()
      const click = listeners.find((l) => l.type === 'click')
      assert.ok(click, 'mountHelp listens on document')
      const event = fire(click.fn, 'como-ler.html#atlas')
      assert.equal(event.defaultPrevented, true)
      assert.equal(dialog.open, true)
      assert.deepEqual(scrolled, ['help-atlas'])
    })
  })

  it('modifier-click, target=_blank and data-leave still go to the page', () => {
    withHelpDom(({ dialog, listeners }) => {
      mountHelp()
      const click = listeners.find((l) => l.type === 'click')!
      assert.equal(fire(click.fn, 'como-ler.html', { metaKey: true }).defaultPrevented, false)
      assert.equal(fire(click.fn, 'como-ler.html', { target: '_blank' }).defaultPrevented, false)
      assert.equal(fire(click.fn, 'como-ler.html', { dataLeave: true }).defaultPrevented, false)
      assert.equal(dialog.open, false)
    })
  })

  it('openHelp/closeHelp are a no-op without a dialog, and close a mounted one', () => {
    const previous = (globalThis as { document?: unknown }).document
    ;(globalThis as { document?: unknown }).document = { getElementById: () => null }
    try {
      openHelp('atlas')
      closeHelp()
    } finally {
      ;(globalThis as { document?: unknown }).document = previous
    }
    withHelpDom(({ dialog, scrolled }) => {
      mountHelp()
      openHelp('pmi')
      assert.equal(dialog.open, true)
      assert.deepEqual(scrolled, ['help-pmi'])
      closeHelp()
      assert.equal(dialog.open, false)
    })
  })
})
