import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mountDocsCard } from '../public/js/docs-card.js'
import { mount as mountAtlas } from '../public/js/figures/atlas.js'
import { mount as mountCompare } from '../public/js/figures/compare.js'
import { mount as mountTestimony } from '../public/js/figures/testimony.js'
import { clearScopes } from '../public/js/state.js'
import { persons } from './fixture.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'

// The documents card, driven through the real mount()s. The button in the inspector is gone, so
// every figure asks for texts with its own click: the atlas by picking a word or the person at
// the centre, the testimony strip by focusing an outlet, the ruler by picking a word — and the
// ruler asks BOTH people at once. The card belongs to none of them (public/js/docs-card.js), so
// each request carries its own recorte and its own title.

const people = persons.map(({ id, name }) => ({ id, name }))
const [personA, personB] = people

const term = { id: 'word:reforma', term: 'reforma', kind: 'word', count: 12, pmi: 1.4, score: 1.4 }
const graph = { person: personA, nodes: [term], links: [], stats: { about: 40, testimony: { method: 'kikori', score: null, n: 0 } } }
const docs = { docs: [{ source: 'rss', domain: 'g1.globo.com', text: 'um texto', url: 'https://g1.globo.com/a' }], total: 3 }
const testimony = {
  method: 'kikori',
  overall: { score: -2, n: 9 },
  by_source: [{ source: 'gnews', score: -2, n: 9 }],
  by_domain: [{ domain: 'g1.globo.com', source: 'gnews', score: -3, n: 9 }],
}
const compare = {
  a: { person: personA, docs: 10 },
  b: { person: personB, docs: 8 },
  measure: 'count',
  terms: [{ term: 'reforma', kind: 'word', a: { count: 6, pmi: 1.2, score: 6 }, b: { count: 2, pmi: 0.4, score: 2 } }],
}

const docsCalls = (calls: string[]) => calls.filter((url) => url.includes('/docs?'))

// The list is the one face of figure 1 this harness can click: fake-mount-dom resolves only
// queries rooted on an element, and paintColumns wires its rows that way. The map's words and
// its centre emit the same attributes and run through the same handlers.
describe('figure 1: picking a word opens its documents, with no button in between', () => {
  it('a row click GETs /docs for that term and opens the card; clicking it again closes it', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': people, '/graph': graph, '/docs': docs })
      mountDocsCard()
      mountAtlas(els.workspace, { people, initial: { person: personA.id } })
      await flush()
      els.modeColumns.fire('click')
      await flush()
      assert.equal(docsCalls(calls).length, 0, 'nothing on the page asks for documents on its own')

      els.columns.querySelectorAll('[data-col]')[0].fire('click')
      await flush()
      const first = docsCalls(calls)
      assert.equal(first.length, 1, 'the pick is the request')
      assert.match(first[0], /term=reforma/)
      assert.match(first[0], /kind=word/)
      assert.equal(els.docsDialog.open, true)
      assert.equal(els.docsKicker.textContent, 'Documentos com palavra')
      assert.equal(els.docsTitle.textContent, 'reforma')

      els.columns.querySelectorAll('[data-col]')[0].fire('click')
      await flush()
      assert.equal(els.docsDialog.open, false, 'releasing the word puts its card away')
    })
  })

  it("the person's own entry point asks for her documents, not a term's", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': people, '/graph': graph, '/docs': docs })
      mountDocsCard()
      mountAtlas(els.workspace, { people, initial: { person: personA.id } })
      await flush()
      els.modeColumns.fire('click')
      await flush()

      els.columns.querySelectorAll('[data-person-docs]')[0].fire('click')
      await flush()
      const forPerson = docsCalls(calls)
      assert.equal(forPerson.length, 1)
      assert.match(forPerson[0], /term=&|term=$/, 'no term: these are the documents about the person')
      assert.match(forPerson[0], /kind=all/)
      assert.equal(els.docsKicker.textContent, 'Documentos sobre')
      assert.equal(els.docsTitle.textContent, personA.name)
    })
  })

  it('the close button puts the card away and the next click brings it back', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': people, '/graph': graph, '/docs': docs })
      mountDocsCard()
      mountAtlas(els.workspace, { people, initial: { person: personA.id } })
      await flush()
      els.modeColumns.fire('click')
      await flush()

      els.columns.querySelectorAll('[data-person-docs]')[0].fire('click')
      await flush()
      els.docsClose.fire('click')
      assert.equal(els.docsDialog.open, false)

      els.columns.querySelectorAll('[data-person-docs]')[0].fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
    })
  })
})

describe('figure 2: focusing an outlet also opens that outlet\'s texts', () => {
  it('the click carries domain and this figure\'s own recorte, and never a term', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/sources': [{ domain: 'g1.globo.com', source: 'gnews', docs: 9 }],
        '/testimony': testimony,
        '/docs': docs,
      })
      mountDocsCard()
      mountTestimony(els.testimony, { people, initial: { person: personA.id } })
      await flush()
      assert.equal(docsCalls(calls).length, 0, 'painting the figure asks for no documents')

      els.outletList.querySelectorAll('[data-domain]')[0].fire('click')
      await flush()
      const forOutlet = docsCalls(calls)
      assert.equal(forOutlet.length, 1)
      assert.match(forOutlet[0], /\/api\/people\/lula\/docs\?/, "figure 2's own person, not figure 1's")
      assert.match(forOutlet[0], /domain=g1\.globo\.com/)
      assert.match(forOutlet[0], /term=&|term=$/, 'an outlet is a different question from a word')
      assert.equal(els.docsDialog.open, true)
      assert.equal(els.docsKicker.textContent, 'Documentos de')
      assert.equal(els.docsTitle.textContent, 'g1.globo.com')
    })
  })

  it('releasing the outlet closes the card', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/sources': [{ domain: 'g1.globo.com', source: 'gnews', docs: 9 }], '/testimony': testimony, '/docs': docs })
      mountDocsCard()
      mountTestimony(els.testimony, { people, initial: { person: personA.id } })
      await flush()
      els.outletList.querySelectorAll('[data-domain]')[0].fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      els.outletList.fire('click', { target: { closest: () => null } })
      await flush()
      assert.equal(els.docsDialog.open, false, 'a click on empty space in the figure releases both')
    })
  })
})

describe('figure 3: a word on the ruler opens both people at once', () => {
  it('two requests, one per person, same word and same recorte', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/compare': compare, '/docs': docs })
      mountDocsCard()
      mountCompare(els.compare, { people, initial: { a: personA.id, b: personB.id } })
      await flush()
      assert.equal(docsCalls(calls).length, 0)

      els.compareRuler.querySelectorAll('[data-term]')[0].fire('click')
      await flush()
      const both = docsCalls(calls)
      assert.equal(both.length, 2, 'a word here belongs to neither person alone')
      assert.ok(
        both.some((u) => u.includes(`/people/${personA.id}/docs`)) && both.some((u) => u.includes(`/people/${personB.id}/docs`)),
        'one side each',
      )
      for (const url of both) assert.match(url, /term=reforma/)
      assert.equal(els.docsDialog.open, true)
      assert.equal(els.docsTitle.textContent, 'reforma')
    })
  })

  it('picking the same word again closes the card', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/compare': compare, '/docs': docs })
      mountDocsCard()
      mountCompare(els.compare, { people, initial: { a: personA.id, b: personB.id } })
      await flush()
      const mark = () => els.compareRuler.querySelectorAll('[data-term]')[0]
      mark().fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      mark().fire('click')
      await flush()
      assert.equal(els.docsDialog.open, false)
    })
  })
})
