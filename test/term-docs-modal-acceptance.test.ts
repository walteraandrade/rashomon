import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect, paintDocsTitle } from '../public/js/render.js'
import { withFakeDocument } from './fake-dom.js'

// The documents panel used to live inside the inspector: first as a button plus a sibling
// <div id="docs">, then as a <details> accordion. Both fetched /docs for the person on every
// unselected paint, and a long text grew the reading page. The documents now open in a modal
// (<dialog id="docsDialog">) that is the only path to GET /docs: the inspector emits one
// button and never asks for documents on its own.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (name: string) => readFileSync(join(root, 'public', name), 'utf8')

const term = { id: 'word:reforma', term: 'reforma', kind: 'word', count: 12, pmi: 1.4 }
const graph = { person: { id: 'p1', name: 'Alguém' }, stats: { about: 40 }, nodes: [term], links: [] }

const paint = (selected: string | null, onShowDocs: (n: unknown) => void = () => {}) =>
  withFakeDocument(['inspector'], (els) => {
    inspect({ graph, nodes: [term], links: [], selected, sort: 'pmi', daysLabel: '30 dias', onChoose: () => {}, onShowDocs })
    return els.inspector.innerHTML
  })

describe('term documents open in a modal, and only on request', () => {
  it('the inspector emits one button per state and no docs container of its own', () => {
    const forTerm = paint(term.id)
    assert.match(forTerm, /<button class="docs-open" id="docsOpen">Ler documentos deste termo<\/button>/)
    const forPerson = paint(null)
    assert.match(forPerson, /<button class="docs-open" id="docsOpen">Ler documentos sobre a pessoa<\/button>/)
    for (const html of [forTerm, forPerson]) {
      assert.doesNotMatch(html, /id="docs"/, 'the documents live in the dialog, not in the inspector')
      assert.doesNotMatch(html, /<details|id="termDocs"|id="showDocs"/)
    }
  })

  it('painting the inspector never asks for documents, selected or not', () => {
    const calls: unknown[] = []
    paint(null, (n) => calls.push(n))
    paint(term.id, (n) => calls.push(n))
    assert.deepEqual(calls, [], 'GET /docs happens on the button click only')
  })

  it('design-5.html holds the dialog with the docs container, its title and a close button', () => {
    const html = read('design-5.html')
    const dialog = html.match(/<dialog class="docs-dialog" id="docsDialog"[^>]*>([\s\S]*?)<\/dialog>/)?.[1] ?? ''
    assert.ok(dialog, 'the dialog must exist')
    assert.match(dialog, /<h2 id="docsTitle"><\/h2>/)
    assert.match(dialog, /<button id="docsClose"/)
    assert.match(dialog, /<div id="docs" aria-live="polite"><\/div>/)
    assert.equal(html.match(/id="docs"/g)?.length, 1, 'one docs container on the page')
  })

  it('paintDocsTitle names the term or the person in the dialog head', () => {
    withFakeDocument(['docsKicker', 'docsTitle'], (els) => {
      paintDocsTitle({ term, personName: 'Alguém' })
      assert.equal(els.docsKicker.textContent, 'Documentos com palavra')
      assert.equal(els.docsTitle.textContent, 'reforma')
      paintDocsTitle({ term: null, personName: 'Alguém' })
      assert.equal(els.docsKicker.textContent, 'Documentos sobre')
      assert.equal(els.docsTitle.textContent, 'Alguém')
    })
  })

  it('atlas.css scrolls the documents inside the dialog instead of growing the page', () => {
    const css = read('atlas.css')
    assert.match(css, /\.docs-dialog \{[^}]*max-height/)
    assert.match(css, /#docs \{[^}]*overflow-y:\s*auto/)
    assert.doesNotMatch(css, /\.docs-toggle/)
  })
})
