import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pageMarkup } from './pages.js'
import { closeHelp, openHelp } from '../src/ui/help.svelte.js'

const atlasPage = () => pageMarkup('/')

type Link = unknown

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

describe('help.svelte.ts: openHelp and closeHelp (link interception lives in test/components/help.spec.ts)', () => {

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
      openHelp('pmi')
      assert.equal(dialog.open, true)
      assert.deepEqual(scrolled, ['help-pmi'])
      closeHelp()
      assert.equal(dialog.open, false)
    })
  })

  // issue #207: figure 9's "Como ler" link (como-ler.html#junto) must resolve like every other
  // figure's, not fall through HELP_SECTIONS and scroll nowhere.
  it("openHelp('#junto') opens the dialog at figure 9's section", () => {
    withHelpDom(({ dialog, scrolled }) => {
      openHelp('#junto')
      assert.equal(dialog.open, true)
      assert.deepEqual(scrolled, ['help-junto'])
    })
  })

  // issue #215: figure 10's "Como ler" link (como-ler.html#persistencia) must resolve like every
  // other figure's, not fall through HELP_SECTIONS and scroll nowhere.
  it("openHelp('#persistencia') opens the dialog at figure 10's section", () => {
    withHelpDom(({ dialog, scrolled }) => {
      openHelp('#persistencia')
      assert.equal(dialog.open, true)
      assert.deepEqual(scrolled, ['help-persistencia'])
    })
  })

  it('every como-ler.html#<x> link in the atlas page resolves through openHelp and has a matching id="help-<x>"', () => {
    const html = atlasPage()
    const hashes = [...html.matchAll(/como-ler#([\w-]+)/g)].map((m) => m[1])
    assert.ok(hashes.length > 0, 'atlas.html must link to /como-ler at least once')
    for (const hash of hashes) {
      assert.match(html, new RegExp(`id="help-${hash}"`), `atlas.html has no id="help-${hash}" for the /como-ler#${hash} link`)
      withHelpDom(({ scrolled }) => {
        openHelp(`#${hash}`)
        assert.deepEqual(scrolled, [`help-${hash}`], `openHelp('#${hash}') must scroll to #help-${hash}, not fall through HELP_SECTIONS`)
      })
    }
  })
})
