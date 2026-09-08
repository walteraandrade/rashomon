import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect } from '../public/js/render.js'
import { withFakeDocument } from './fake-dom.js'

// The documents panel used to be a <button> followed by a sibling <div id="docs">, so opening
// it pushed the rest of the inspector down the page. It is now a <details> accordion that
// grows in place and scrolls internally.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const atlasCss = () => readFileSync(join(root, 'public', 'atlas.css'), 'utf8')

const term = { id: 'word:reforma', term: 'reforma', kind: 'word', count: 12, pmi: 1.4 }
const graph = { person: { id: 'p1', name: 'Alguém' }, stats: { about: 40 }, nodes: [term], links: [] }

const paint = () =>
  withFakeDocument(['inspector'], (els) => {
    inspect({ graph, nodes: [term], links: [], selected: term.id, sort: 'pmi', daysLabel: '30 dias', onChoose: () => {}, onShowDocs: () => {} })
    return els.inspector.innerHTML
  })

describe('term documents open as an accordion instead of pushing the page down', () => {
  it('the inspector emits a <details> accordion that wraps the docs panel', () => {
    const html = paint()
    assert.match(html, /<details class="docs-toggle" id="termDocs">/)
    assert.match(html, /<summary>Ler documentos deste termo<\/summary>/)
    assert.match(html, /<details[^>]*>\s*<summary>[^<]*<\/summary><div id="docs"[^>]*><\/div><\/details>/)
  })

  it('the old always-visible trigger button is gone', () => {
    assert.doesNotMatch(paint(), /id="showDocs"/)
  })

  it('atlas.css caps the docs panel height so the accordion scrolls instead of growing without bound', () => {
    const css = atlasCss()
    assert.match(css, /#docs \{[^}]*max-height:\s*\d+px/)
    assert.match(css, /#docs \{[^}]*overflow-y:\s*auto/)
    assert.match(css, /\.docs-toggle summary \{/)
  })
})
