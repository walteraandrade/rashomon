import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drawMap, inspect, paintColumns, paintDocsTitle } from '../public/js/render.js'
import { withFakeDocument } from './fake-dom.js'

// The documents panel used to live inside the inspector: first as a button plus a sibling
// <div id="docs">, then as a <details> accordion, then behind one "Ler documentos" button that
// opened a modal. The button is gone: a word opens its own texts when it is picked, and the
// person's own two entry points -- the centre of the map, the head of the list -- open hers.
// The card that holds them is still the single #docsDialog, and still the only path to /docs.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (name: string) => readFileSync(join(root, 'public', name), 'utf8')

const term = { id: 'word:reforma', term: 'reforma', kind: 'word', count: 12, pmi: 1.4 }
const graph = { person: { id: 'p1', name: 'Alguém' }, stats: { about: 40 }, nodes: [term], links: [] }

const paint = (selected: string | null) =>
  withFakeDocument(['inspector'], (els) => {
    inspect({ graph, nodes: [term], links: [], selected, sort: 'pmi', daysLabel: '30 dias', onChoose: () => {} })
    return els.inspector.innerHTML
  })

describe('the inspector carries no documents button', () => {
  it('neither state emits one, and neither holds a docs container', () => {
    for (const html of [paint(term.id), paint(null)]) {
      assert.doesNotMatch(html, /docs-open|id="docsOpen"|Ler documentos/)
      assert.doesNotMatch(html, /id="docs"/, 'the documents live in the card, not in the inspector')
      assert.doesNotMatch(html, /<details|id="termDocs"|id="showDocs"/)
    }
  })

  it('atlas.css no longer styles the button', () => {
    assert.doesNotMatch(read('atlas.css'), /\.docs-open/)
  })
})

describe("the person's own entry points to her documents", () => {
  const layout = {
    placed: [{ id: term.id, term: 'reforma', kind: 'word', count: 12, pmi: 1.4, x: 0, y: -100, w: 90, h: 30, size: 20, lines: ['reforma'], lineHeight: 22, rank: 0, score: 1.4 }],
    overflow: [],
    center: { lines: ['Alguém'], size: 52, lineHeight: 57, w: 240, h: 145, x: 0, y: 0 },
  }

  it('the centre of the map is a real button, and painting it fetches nothing', () => {
    withFakeDocument(['viewport', 'overflow', 'legend'], (els) => {
      const calls: string[] = []
      drawMap({ layout, personName: 'Alguém', about: 40, mode: 'map', sort: 'pmi', onChoose: () => {}, onShowPerson: () => calls.push('person') })
      assert.match(els.viewport.innerHTML, /<g class="center-label" data-person-docs role="button" tabindex="0"/)
      assert.equal(els.viewport.innerHTML.match(/data-person-docs/g)?.length, 1, 'exactly one centre, and it is the entry point')
      assert.doesNotMatch(els.viewport.innerHTML, /class="word-button"[^>]*data-person-docs/, 'a word is never the person')
      assert.equal(calls.length, 0, 'painting opens nothing on its own')
    })
  })

  it('the list has no centre, so it carries the same entry at its head', () => {
    withFakeDocument(['columns'], (els) => {
      const calls: string[] = []
      paintColumns({
        nodes: [term], links: [], selected: null, search: '', sort: 'pmi', mode: 'columns',
        onChoose: () => {}, onShowPerson: () => calls.push('person'), personName: 'Alguém', about: 40,
      })
      assert.match(els.columns.innerHTML, /<div class="column-person" data-person-docs role="button" tabindex="0"/)
      assert.match(els.columns.innerHTML, /<strong>Alguém<\/strong>/)
      assert.equal(els.columns.innerHTML.match(/data-person-docs/g)?.length, 1)
      assert.equal(calls.length, 0, 'painting opens nothing on its own')
    })
  })
})

describe('the card that holds the documents', () => {
  it('design-5.html holds one dialog with the docs container, its title, its grip and a close button', () => {
    const html = read('design-5.html')
    const dialog = html.match(/<dialog class="docs-dialog" id="docsDialog"[^>]*>([\s\S]*?)<\/dialog>/)?.[1] ?? ''
    assert.ok(dialog, 'the dialog must exist')
    assert.match(dialog, /<h2 id="docsTitle"><\/h2>/)
    assert.match(dialog, /<button id="docsClose"/)
    assert.match(dialog, /<div class="docs-dialog-head" id="docsGrip"/, 'the head is what the reader drags')
    assert.match(dialog, /<div id="docs" aria-live="polite"><\/div>/)
    assert.equal(html.match(/id="docs"/g)?.length, 1, 'one docs container on the page')
  })

  it('paintDocsTitle names the term or the person in the card head', () => {
    withFakeDocument(['docsKicker', 'docsTitle'], (els) => {
      paintDocsTitle({ term, personName: 'Alguém' })
      assert.equal(els.docsKicker.textContent, 'Documentos com palavra')
      assert.equal(els.docsTitle.textContent, 'reforma')
      paintDocsTitle({ term: null, personName: 'Alguém' })
      assert.equal(els.docsKicker.textContent, 'Documentos sobre')
      assert.equal(els.docsTitle.textContent, 'Alguém')
    })
  })

  it('atlas.css floats it on a wide screen, drags it by the head, and scrolls inside it', () => {
    const css = read('atlas.css')
    assert.match(css, /\.docs-dialog \{[^}]*max-height/)
    assert.match(css, /#docs \{[^}]*overflow-y:\s*auto/)
    assert.match(css, /\.docs-dialog\.is-floating \{[^}]*position:\s*fixed/)
    assert.match(css, /\.docs-dialog\.is-floating \.docs-dialog-head \{[^}]*cursor:\s*grab/)
    assert.doesNotMatch(css, /\.docs-toggle/)
  })
})
