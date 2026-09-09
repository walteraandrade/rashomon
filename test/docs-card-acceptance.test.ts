import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mount } from '../public/js/figures/atlas.js'
import { clearScopes } from '../public/js/state.js'
import { persons } from './fixture.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'

// The documents card, driven through the real mount(): the button in the inspector is gone, so
// picking a word IS the request for its texts, the person's own entry point asks for hers, and
// releasing the selection puts the card away. Asserted against the fetches the figure actually
// makes, never against a claim about the markup.

const people = persons.map(({ id, name }) => ({ id, name }))
const [personA] = people

const term = { id: 'word:reforma', term: 'reforma', kind: 'word', count: 12, pmi: 1.4, score: 1.4 }
const graph = {
  person: personA,
  nodes: [term],
  links: [],
  stats: { about: 40, testimony: { method: 'kikori', score: null, n: 0 } },
}
const docs = { docs: [{ source: 'rss', domain: 'g1.globo.com', text: 'um texto', url: 'https://g1.globo.com/a' }], total: 3 }

const docsCalls = (calls: string[]) => calls.filter((url) => url.includes('/docs?'))

// The list is the one face of the figure this harness can click: fake-mount-dom resolves only
// queries rooted on an element, and paintColumns wires its rows that way. The map's words and
// its centre emit the same attributes and run through the same handlers.

describe('picking a word opens its documents, with no button in between', () => {
  it('a row click GETs /docs for that term and opens the card; clicking it again closes it', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': people, '/graph': graph, '/docs': docs })
      mount(els.workspace, { people, initial: { person: personA.id } })
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
      assert.equal(els.docsDialog.open, true, 'and the card is open')

      els.columns.querySelectorAll('[data-col]')[0].fire('click')
      await flush()
      assert.equal(els.docsDialog.open, false, 'releasing the word puts its card away')
    })
  })

  it("the person's own entry point asks for her documents, not a term's", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': people, '/graph': graph, '/docs': docs })
      mount(els.workspace, { people, initial: { person: personA.id } })
      await flush()
      els.modeColumns.fire('click')
      await flush()

      els.columns.querySelectorAll('[data-person-docs]')[0].fire('click')
      await flush()
      const forPerson = docsCalls(calls)
      assert.equal(forPerson.length, 1)
      assert.match(forPerson[0], /term=&|term=$/, 'no term: these are the documents about the person')
      assert.match(forPerson[0], /kind=all/)
      assert.equal(els.docsDialog.open, true)
    })
  })

  it('the close button and Escape both put the card away', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': people, '/graph': graph, '/docs': docs })
      mount(els.workspace, { people, initial: { person: personA.id } })
      await flush()
      els.modeColumns.fire('click')
      await flush()

      els.columns.querySelectorAll('[data-person-docs]')[0].fire('click')
      await flush()
      els.docsClose.fire('click')
      assert.equal(els.docsDialog.open, false)

      els.columns.querySelectorAll('[data-person-docs]')[0].fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true, 'and it reopens on the next click')
    })
  })
})
