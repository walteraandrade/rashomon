import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { createHandlers } from '../src/ui/figures/atlas.js'
import { sourceLabels } from '../src/ui/format.js'
import { persons } from './fixture.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'

// Issue #28's acceptance criteria, re-derived after issue #37 split design-5.html into
// public/js/*.js + public/atlas.css. The old version grepped the page's inline <script> as
// text for function bodies; every criterion below now runs against the real module instead:
// packing/overflow in test/layout.test.ts, pt-BR source labels in test/format.test.ts, and
// the search-highlighting rule here, against app.js's own event table.

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// Records which injected action each handler calls, so a criterion can assert both what was
// called and what was deliberately not.
const spies = () => {
  const calls: string[] = []
  const spy = (name: string) => () => {
    calls.push(name)
  }
  const actions = {
    paintCurrentSelection: spy('paintCurrentSelection'),
    choose: spy('choose'),
    load: spy('load'),
    loadCandidates: spy('loadCandidates'),
    setMode: spy('setMode'),
    setZoom: spy('setZoom'),
    getZoomLevel: () => 1,
    clearSearch: spy('clearSearch'),
    canClear: () => true,
    updateHeader: spy('updateHeader'),
    setSource: spy('setSource'),
  }
  return { calls, handlers: createHandlers(actions) }
}

describe('unified atlas acceptance criteria (issue #28), re-verified after the issue #37 module split', () => {
  it('GET / serves the atlas as HTML, not a build artifact', async () => {
    const res = await app.request('/')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/html/)
  })

  it('the extracted stylesheet and the one script the page loads are served with the right mime type', async () => {
    const css = await app.request('/atlas.css')
    assert.equal(css.status, 200)
    assert.match(css.headers.get('content-type') ?? '', /text\/css/)
    // The modules are TypeScript under src/ui now, so public/bundle.js is the only script the
    // page loads and the only one that can carry a JavaScript mime type.
    const bundle = await app.request('/bundle.js')
    assert.equal(bundle.status, 200, '/bundle.js must be served')
    assert.match(bundle.headers.get('content-type') ?? '', /javascript/, '/bundle.js must be served with a JavaScript content type')
  })

  // Issue #108: the two legacy pages are deleted outright, not just unlinked. Neither
  // public/index.html nor public/atlas-legacy.html exists any more, and both 404 through the
  // same catch-all static handler that already 404s an archived design.
  it('AC8: the two deleted legacy pages 404 and no longer exist under public/', async () => {
    for (const rel of ['index.html', 'atlas-legacy.html']) {
      assert.ok(!existsSync(join(root, 'public', rel)), `public/${rel} must not exist`)
      const res = await app.request(`/${rel}`)
      assert.equal(res.status, 404, `GET /${rel} must 404`)
    }
  })

  // Deleting atlas-legacy.html left two dead hrefs in como-ler.html while the suite stayed
  // green: nothing checked that a link between served pages resolves. A page that names a
  // file is a page that must find it.
  it('every relative link in a served page resolves to a file under public/', () => {
    for (const page of readdirSync(join(root, 'public')).filter((f) => f.endsWith('.html'))) {
      const html = readFileSync(join(root, 'public', page), 'utf8')
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
      const local = hrefs.filter((h) => !/^(https?:)?\/\/|^#|^mailto:|^\/_vercel\//.test(h))
      for (const href of local) {
        const rel = href.split(/[?#]/)[0].replace(/^\//, '')
        if (!rel) continue
        assert.ok(existsSync(join(root, 'public', rel)), `public/${page} links to ${href}, which does not exist under public/`)
      }
    }
  })

  it('archived design alternatives moved out of public/ are no longer served', async () => {
    for (const path of ['/design-1.html', '/design-2.html', '/design-3.html', '/design-4.html', '/design-6.html', '/designs.html', '/graph-lab.html', '/graph-circle-lab.html']) {
      const res = await app.request(path)
      assert.equal(res.status, 404, `${path} must 404 now that it lives in docs/designs/, not public/`)
    }
  })

  it('search highlighting does not rebuild the inspector or wipe loaded documents', () => {
    const { calls, handlers } = spies()
    handlers.search()
    assert.deepEqual(calls, ['paintCurrentSelection'], 'typing in the search box may only repaint the selection: rebuilding the inspector re-renders #docs and wipes the documents already loaded')
  })

  it('clearing the selection resets the search box and deselects, without reloading the graph', () => {
    const { calls, handlers } = spies()
    handlers.clear()
    assert.deepEqual(calls, ['clearSearch', 'choose'])
  })

  it('Escape clears the same way, and any other key does nothing at all', () => {
    const escape = spies()
    escape.handlers.keydown({ key: 'Escape' })
    assert.deepEqual(escape.calls, ['clearSearch', 'choose'])
    const other = spies()
    other.handlers.keydown({ key: 'a' })
    assert.deepEqual(other.calls, [])
  })

  it("issue #92 AC6: figures/atlas.js's control('person') never references an outlet any more; only the period control refetches candidates", () => {
    const person = spies()
    person.handlers.control('person')()
    assert.deepEqual(person.calls, ['updateHeader', 'load'], 'the outlet in focus belongs to figure 2 now; resetOutlet is gone from the action interface')
    const days = spies()
    days.handlers.control('days')()
    assert.deepEqual(days.calls, ['loadCandidates', 'updateHeader', 'load'])
    const sort = spies()
    sort.handlers.control('sort')()
    assert.deepEqual(sort.calls, ['updateHeader', 'load'])
  })

  it("issue #92 AC6: changing testimony's own person, days or source control releases testimony's own focused outlet", async () => {
    await withFiguresDom(async (els, calls) => {
      const { mount } = await import('../src/ui/figures/testimony.js')
      const people = persons.map(({ id, name }) => ({ id, name }))
      routeFetch(calls, {
        '/sources': [{ domain: 'g1.globo.com', source: 'gnews', docs: 5 }],
        '/testimony': { method: 'kikori', overall: { score: null, n: 0 }, by_source: [], by_domain: [] },
      })
      mount(els.testimony, { people, initial: { person: people[0].id } })
      await flush()
      const [button] = els.outletList.querySelectorAll('[data-domain]')
      assert.ok(button, 'the mocked /sources row must render one clickable outlet')
      button.fire('click')
      assert.equal(els.domainLabel.textContent, ' · g1.globo.com', 'picking an outlet focuses it locally, inside this figure')
      els.testimonyDays.value = '365'
      els.testimonyDays.fire('change')
      await flush(200)
      assert.equal(els.domainLabel.textContent, '', "changing this figure's own period control released the outlet")
    })
  })

  it('every source segment goes through the same handler: set the source, then reload the recorte', () => {
    for (const source of Object.keys(sourceLabels)) {
      const { calls, handlers } = spies()
      handlers.source(source)()
      assert.deepEqual(calls, ['setSource', 'load', 'updateHeader'], `${source} must reuse the shared segment handler`)
    }
  })

  it('atlas.css keeps the sentence controls and the mode segment usable on mobile widths (issue #28)', () => {
    const css = readFileSync(join(root, 'public', 'atlas.css'), 'utf8')
    assert.match(css, /\.pick select\s*\{[^}]*max-width:\s*100%;/, 'every select in the sentence must shrink to the screen')
    assert.match(css, /\.segment\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/)
  })
})
