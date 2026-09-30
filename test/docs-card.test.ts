import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { siteFile } from './pages.js'

const read = (name: string) => siteFile(name)

// The documents card, driven through the real component mounts. The button in the inspector is gone, so
// every figure asks for texts with its own click: the atlas by picking a word or the person at
// the centre, the testimony strip by focusing an outlet, the ruler by picking a word — and the
// ruler asks BOTH people at once. The card belongs to none of them (docs-card.svelte.ts), so
// each request carries its own recorte and its own title.

describe('the card that holds the documents: markup and stylesheet', () => {
  it('atlas.html holds one dialog with the docs container, its title, its grip and a close button', () => {
    const html = read('atlas.html')
    const dialog = html.match(/<dialog\b[^>]*\bid="docsDialog"[^>]*>([\s\S]*?)<\/dialog>/)?.[1] ?? ''
    assert.ok(dialog, 'the dialog must exist')
    assert.match(dialog, /<h2 id="docsTitle"><\/h2>/)
    assert.match(dialog, /<button id="docsClose"/)
    assert.match(dialog, /<div class="docs-dialog-head" id="docsGrip"/, 'the head is what the reader drags')
    assert.match(dialog, /<div id="docs" aria-live="polite"><\/div>/)
    assert.equal(html.match(/id="docs"/g)?.length, 1, 'one docs container on the page')
  })

  it('atlas.css floats it on a wide screen, drags it by the head, and scrolls inside it', () => {
    const css = read('atlas.css')
    assert.match(css, /\.docs-dialog \{[^}]*max-height/)
    assert.match(css, /#docs \{[^}]*overflow-y:\s*auto/)
    assert.match(css, /\.docs-dialog\.is-floating \{[^}]*position:\s*fixed/)
    assert.match(css, /\.docs-dialog\.is-floating \.docs-dialog-head \{[^}]*cursor:\s*grab/)
    assert.doesNotMatch(css, /\.docs-toggle/)
  })

  it('atlas.css no longer styles the old inspector button', () => {
    assert.doesNotMatch(read('atlas.css'), /\.docs-open/)
  })
})
