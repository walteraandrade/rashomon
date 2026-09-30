import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mountDocsCard } from '../src/ui/docs-card.js'
import { mount as mountRising } from '../src/ui/figures/rising.js'
import { clearScopes } from '../src/ui/state.js'
import { persons } from './fixture.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import { siteFile } from './pages.js'

const read = (name: string) => siteFile(name)

// The documents card, driven through the real mount()s. The button in the inspector is gone, so
// every figure asks for texts with its own click: the atlas by picking a word or the person at
// the centre, the testimony strip by focusing an outlet, the ruler by picking a word — and the
// ruler asks BOTH people at once. The card belongs to none of them (public/js/docs-card.js), so
// each request carries its own recorte and its own title.

const people = persons.map(({ id, name }) => ({ id, name }))
const [personA] = people

const docs = { docs: [{ source: 'rss', domain: 'g1.globo.com', text: 'um texto', url: 'https://g1.globo.com/a' }], total: 3 }
const rising = {
  days: 7,
  baseline: 30,
  outlets: [],
  about: { recent: 8, baseline: 3 },
  terms: [{ term: 'reforma', kind: 'word', count_recent: 1.71, count_baseline: 0.03, count_recent_raw: 12, count_baseline_raw: 1, lift: 57 }],
}

const docsCalls = (calls: string[]) => calls.filter((url) => url.includes('/docs?'))

describe('figure 4 (rising) opens one side, scoped to the last 7 days, and releases it the same way the other figures do', () => {
  it('picking a word requests exactly one /docs call, for the tracked person, days=7, term=the word', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/rising': rising, '/docs': docs })
      mountDocsCard()
      mountRising(els.rising, { people, initial: { person: personA.id, source: 'gdelt' } })
      await flush()
      assert.equal(docsCalls(calls).length, 0, 'painting the figure asks for no documents')

      els.risingRuler.querySelectorAll('[data-term]')[0].fire('click')
      await flush()
      const only = docsCalls(calls)
      assert.equal(only.length, 1, 'a rising word belongs to one person, not two')
      assert.match(only[0], new RegExp(`/people/${personA.id}/docs\\?`), "figure 4's own tracked person")
      assert.match(only[0], /days=7\b/, 'always the recent window, never the figure\'s own 30-day baseline')
      assert.match(only[0], /term=reforma/)
      assert.match(only[0], /source=gdelt/, "the figure's own source scope travels with the pick")
      assert.equal(els.docsDialog.open, true)
      assert.equal(els.docsTitle.textContent, 'reforma')
    })
  })

  it('picking the same word again closes the card', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/rising': rising, '/docs': docs })
      mountDocsCard()
      mountRising(els.rising, { people, initial: { person: personA.id } })
      await flush()
      const mark = () => els.risingRuler.querySelectorAll('[data-term]')[0]
      mark().fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      mark().fire('click')
      await flush()
      assert.equal(els.docsDialog.open, false)
    })
  })

  it('clicking empty space inside #rising releases the selection and closes the card', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/rising': rising, '/docs': docs })
      mountDocsCard()
      mountRising(els.rising, { people, initial: { person: personA.id } })
      await flush()
      els.risingRuler.querySelectorAll('[data-term]')[0].fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      els.risingRuler.fire('click', { target: { closest: () => null } })
      await flush()
      assert.equal(els.docsDialog.open, false)
    })
  })
})

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
