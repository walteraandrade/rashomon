import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { testimonyParams } from '../src/ui/api.js'
import { mount } from '../src/ui/figures/testimony.js'
import { signed } from '../src/ui/format.js'
import { paintTestimony } from '../src/ui/render.js'
import { clearScopes } from '../src/ui/state.js'
import { withFakeDocument } from './fake-dom.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import { persons, seed } from './fixture.js'
import './close.js'

// src/ui/figures/testimony.ts, figure 2: the outlet in focus, its own controls, its own
// ResizeObserver, and the markup of its card. The painters are in test/render.test.ts.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (name: string) => readFileSync(join(root, 'public', name), 'utf8')
const people = persons.map(({ id, name }) => ({ id, name }))
const [personA] = people
const oneOutlet = {
  '/sources': [{ domain: 'g1.globo.com', source: 'gnews', docs: 5 }],
  '/testimony': { method: 'kikori', overall: { score: null, n: 0 }, by_source: [], by_domain: [] },
}

describe('the outlet in focus is local to this figure', () => {
  it('a click on an outlet dot or row leaves the focus alone, and a click on empty space in the figure releases it', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, oneOutlet)
      mount(els.testimony, { people, initial: { person: personA.id } })
      await flush()
      const [button] = els.outletList.querySelectorAll('[data-domain]')
      assert.ok(button, 'the mocked /sources row must render one clickable outlet')
      button.fire('click')
      assert.equal(els.domainLabel.textContent, ' · g1.globo.com')
      els.outletList.fire('click', { target: { closest: (s: string) => (s.includes('data-domain') ? {} : null) } })
      assert.equal(els.domainLabel.textContent, ' · g1.globo.com', 'a click that lands on a selectable outlet must not release the focus')
      els.outletList.fire('click', { target: { closest: () => null } })
      assert.equal(els.domainLabel.textContent, '', 'a click on empty space inside the figure releases it')
    })
  })

  it("changing this figure's own person, days or source control releases its focused outlet (issue #92 AC6)", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, oneOutlet)
      mount(els.testimony, { people, initial: { person: personA.id } })
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

  it("the source control releases it too", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, oneOutlet)
      mount(els.testimony, { people, initial: { person: personA.id } })
      await flush()
      const [button] = els.outletList.querySelectorAll('[data-domain]')
      assert.ok(button, 'the mocked /sources row must render one clickable outlet')
      button.fire('click')
      assert.notEqual(els.domainLabel.textContent, '', 'picking an outlet focuses it')
      els.testimonySource.value = 'gnews'
      els.testimonySource.fire('change')
      await flush(200)
      assert.equal(els.domainLabel.textContent, '', "changing this figure's own source control released the outlet")
    })
  })
})

describe('the strip repaints off its own ResizeObserver, not figure 1\'s resizeMap (issue #92 AC13)', () => {
  it("figures/testimony.js observes #strip with its own ResizeObserver", () => {
    const src = readFileSync(join(root, 'src', 'ui', 'figures', 'testimony.ts'), 'utf8')
    assert.match(src, /new ResizeObserver\(/, 'figure 2 must own its own ResizeObserver')
    assert.match(src, /\.observe\(\$\('strip'\)\)/, "it must observe its own #strip")
  })

  it('resizing #strip through the real ResizeObserver callback repaints the strip with the new width', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      // Capture the callback figures/testimony.js registers on #strip so the test can invoke a
      // resize directly, rather than trusting a claim that a ResizeObserver was constructed.
      const captured: { target: unknown; cb: () => void }[] = []
      class CapturingResizeObserver {
        cb: () => void
        constructor(cb: () => void) {
          this.cb = cb
        }
        observe(target: unknown) {
          captured.push({ target, cb: this.cb })
        }
        disconnect() {}
      }
      ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = CapturingResizeObserver
      routeFetch(calls, {
        '/sources': [],
        '/testimony': { method: 'kikori', overall: { score: 1.5, n: 8 }, by_source: [], by_domain: [{ domain: 'g1.globo.com', source: 'gnews', score: 1.5, n: 8 }] },
      })
      els.strip.clientWidth = 800
      mount(els.testimony, { people, initial: { person: personA.id } })
      await flush()
      const firstMarkup = els.strip.innerHTML
      assert.match(firstMarkup, /viewBox="0 0 800/, 'the strip must first paint at its own clientWidth')
      const stripObserver = captured.find((c) => c.target === els.strip)
      assert.ok(stripObserver, 'figures/testimony.js must observe #strip with its own ResizeObserver')
      els.strip.clientWidth = 400
      stripObserver!.cb()
      const secondMarkup = els.strip.innerHTML
      assert.notEqual(secondMarkup, firstMarkup, 'firing the ResizeObserver callback must repaint the strip')
      assert.match(secondMarkup, /viewBox="0 0 400/, 'the repaint must use the new width')
    })
  })
})

describe('the route and the painter agree on the shape', () => {
  before(() => seed())

  it('what GET /api/people/:id/testimony returns paints without adaptation', async () => {
    const res = await app.request('/api/people/tarcisio/testimony?' + testimonyParams({ days: '30', sort: 'count', limit: '18', source: 'all' }) + '&method=stub')
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.overall.n > 0, 'the fixture must have scored rows in the window, or this proves nothing')
    withFakeDocument(['testimonyLabel', 'testimonyList', 'strip'], (els) => {
      paintTestimony({ data, domain: 'estadao.com.br' })
      assert.equal(els.testimonyLabel.textContent, signed(data.overall.score))
      assert.match(els.testimonyList.innerHTML, /<p class="focus"><b>estadao\.com\.br<\/b>/)
    })
  })
})

describe('the page holds the figure and explains it', () => {
  it('design-5.html gives the avaliação its own figure: title with the score, the strip, then the lists', () => {
    const html = read('design-5.html')
    const figure = html.match(/<section class="figure testimony" id="testimony"([\s\S]*?)<\/section>/)?.[1] ?? ''
    assert.ok(figure, 'the second figure must exist')
    assert.match(figure, /<h2 id="testimonyTitle">Avaliação por veículo <b id="testimonyLabel"><\/b><\/h2>/)
    assert.match(figure, /<figure class="strip" id="strip"[^>]*hidden><\/figure>/)
    assert.match(figure, /<div class="testimony-lists" id="testimonyList">/)
    assert.ok(figure.indexOf('id="strip"') < figure.indexOf('id="testimonyList"'), 'the chart comes before its lists')
    assert.ok(figure.indexOf('id="testimonyList"') < figure.indexOf('id="outlets"'), 'the outlet list closes the figure')
    assert.ok(html.indexOf('id="workspace"') < html.indexOf('id="testimony"'), 'after the atlas figure')
  })

  it('the "Como ler" page defines the scale, the cut and the name bias', () => {
    const chapter = read('como-ler.html').match(/<section class="chapter[^"]*" id="como-ler"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(chapter, /<h2>Gráfico 2 · Avaliação por veículo<\/h2>/)
    assert.match(chapter, /nota de −10 a \+10/)
    assert.match(chapter, /Até −2,5 conta como contra; de \+2,5 para cima, a favor/)
    assert.match(chapter, /nunca compare a nota de uma pessoa com a de outra/)
    assert.match(chapter, /Vale para todas as fontes, ao contrário do tom/)
  })

  it('atlas.css styles the panel from the type ramp, never from a loose px', () => {
    const css = read('atlas.css')
    assert.match(css, /\.testimony \.verdict dd \{[^}]*var\(--tone, var\(--ink\)\)/)
    assert.match(css, /\.strip-mean \{[^}]*var\(--pos/, 'the strip is the one ruler left, and it still places the mean')
    assert.doesNotMatch(css, /\.testimony \.scale/, 'the second ruler under the strip is gone')
    const sizes = [...css.matchAll(/\.testimony[^{]*\{[^}]*font-size:\s*var\((--t-[a-z0-9]+)\)/g)].map((m) => m[1])
    assert.ok(sizes.length >= 3, 'the panel sizes itself from the ramp')
    assert.deepEqual(sizes.filter((s) => s === '--t-micro'), [], 'the 11px floor is for SVG labels only')
  })

  it('design-5.html makes the strip the chart of the second figure, and the como-ler page explains it', () => {
    const html = read('design-5.html')
    const figure = html.match(/<section class="figure testimony" id="testimony"([\s\S]*?)<\/section>/)?.[1] ?? ''
    assert.match(figure, /<\/header>\s*<figure class="strip" id="strip" aria-label="Veículos na régua da avaliação" hidden><\/figure>/)
    const chapter = read('como-ler.html').match(/<section class="chapter[^"]*" id="como-ler"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(chapter, /<b>A régua<\/b>/)
    assert.match(chapter, /a linha vertical é a média da pessoa/)
  })

  it('the figure is one column, with no second ruler and no second outlet ranking', () => {
    const html = read('design-5.html')
    const figure = html.match(/<section class="figure testimony" id="testimony"([\s\S]*?)<\/section>/)?.[1] ?? ''
    assert.ok(figure, 'the second figure must exist')
    assert.doesNotMatch(figure, /figure-lists/, 'the two-column grid left half the width empty')
    assert.doesNotMatch(figure, /<details/, 'the one outlet list is the figure, not a disclosure beside it')
    assert.ok(figure.indexOf('id="testimonyList"') < figure.indexOf('id="outletList"'), 'the summary comes before the list')
  })
})
