import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as appModule from '../src/ui/app.js'
import { paintOutlets, paintTestimony } from '../src/ui/render.js'
import { clearScopes } from '../src/ui/state.js'
import { withFakeDocument } from './fake-dom.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import './close.js'

// The pet: one pixel sprite, allowed in exactly two boxes and nowhere else. The site draws every
// other limit with type, so the rule this file pins is not "the bird looks nice" but "the bird is
// only ever where a graph is absent, and only one of it at a time".

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const readPublic = (name: string) => readFileSync(join(root, 'public', name), 'utf8')
// The front-end modules are TypeScript under src/ui; only the built bundle lives in public/.
const readModule = (name: string) => readFileSync(join(root, 'src', 'ui', name), 'utf8')

const FLYING = 'pet-caracara.png'
const PERCHED = 'pet-caracara-perched.png'

// The sprites' own pixel grids. Every width the CSS may use is an integer multiple of these.
const GRID = { [FLYING]: { w: 106, h: 78 }, [PERCHED]: { w: 26, h: 37 } }

const withData = {
  method: 'kikori:q8',
  overall: { score: -2.16, n: 784 },
  by_source: [{ source: 'bluesky', score: -1.89, n: 621 }],
  by_domain: [{ domain: 'g1.globo.com', source: 'gnews', score: -3.62, n: 13 }],
}
const empty = { method: 'kikori:q8', overall: { score: null, n: 0 }, by_source: [], by_domain: [] }

const withLocation = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  const previous = (globalThis as { location?: unknown }).location
  ;(globalThis as { location?: unknown }).location = { search: '', reload: () => {} }
  try {
    return await fn()
  } finally {
    ;(globalThis as { location?: unknown }).location = previous
  }
}

describe('the pet: the files it ships as', () => {
  it('both sprites exist under public/ and are small enough to inline on a phone', () => {
    for (const name of [FLYING, PERCHED]) {
      const size = statSync(join(root, 'public', name)).size
      assert.ok(size > 0, `${name} must exist under public/`)
      assert.ok(size < 20_000, `${name} is ${size} bytes; a pixel sprite that big means it was not quantised`)
    }
  })
})

describe('the pet: the empty recorte in figure 2', () => {
  it('paintTestimony puts the flying bird up when the recorte scored nothing, and says what to do next', () => {
    withFakeDocument(['testimonyLabel', 'testimonyList', 'strip'], (els) => {
      paintTestimony({ data: empty, domain: 'all' })
      const html = els.testimonyList.innerHTML
      assert.match(html, new RegExp(`src="/${FLYING}"`), 'the empty recorte is the one box a picture is allowed in')
      assert.match(html, /alt=""/, 'the sprite is decorative: the sentence beside it carries the meaning')
      assert.match(html, /Nenhum texto avaliado neste recorte/, 'the honest copy stays; the bird does not replace it')
      assert.match(html, /Tente um per[ií]odo maior ou outra fonte/, 'an empty state that says nothing to do is still a dead end')
    })
  })

  it('the bird leaves as soon as the recorte has data', () => {
    withFakeDocument(['testimonyLabel', 'testimonyList', 'strip'], (els) => {
      paintTestimony({ data: withData, domain: 'all' })
      assert.doesNotMatch(els.testimonyList.innerHTML, /<img/, 'nothing on this page may sit next to a number a reader is reading')
    })
  })

  it('the outlet list under it stays wordless, so one empty recorte can never put two birds up', () => {
    withFakeDocument(['domainLabel', 'outletList'], (els) => {
      paintOutlets({ rows: [], testimony: null, domain: 'all', onPick: () => {} })
      assert.match(els.outletList.innerHTML, /Nenhum ve[ií]culo neste recorte/)
      assert.doesNotMatch(els.outletList.innerHTML, /<img/, 'the bird belongs to #testimonyList only')
    })
  })
})

describe('the pet: the outage in figure 1', () => {
  it('a failed GET /api/people paints the perched bird into the atlas, and keeps every honesty line', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        calls.push(String(input))
        throw new Error('network down')
      }) as typeof fetch
      await withLocation(async () => {
        await appModule.boot()
        await flush()
        const html = els.viewport.innerHTML
        assert.match(html, new RegExp(`src="/${PERCHED}"`), 'the outage box is the other place a picture is allowed')
        assert.match(html, /Falha de rede ou base indispon[ií]vel/, 'the outage still reads as an outage')
        assert.match(html, /fict[ií]cio ser[aá] exibido/, 'the no-fictional-data caveat must survive the decoration')
        assert.match(html, /id="retry"/, 'the retry button must still be emitted')
      })
    })
  })

  it('figures 2 and 3 print the same outage in words only: three birds would read as decoration', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        calls.push(String(input))
        throw new Error('network down')
      }) as typeof fetch
      await withLocation(async () => {
        await appModule.boot()
        await flush()
        assert.doesNotMatch(els.testimonyList.innerHTML, /<img/, 'figure 2 states the outage in words')
        assert.doesNotMatch(els.compareDetail.innerHTML, /<img/, 'figure 3 states the outage in words')
      })
    })
  })

  it('an empty seed stays an empty seed: no bird, and no outage copy', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': [] })
      await withLocation(async () => {
        await appModule.boot()
        await flush()
        assert.doesNotMatch(els.viewport.innerHTML, new RegExp(PERCHED), 'nobody tracked is not the same fact as nothing answering')
      })
    })
  })
})

describe('the pet: the rules atlas.css holds it to', () => {
  it('every .pet is drawn as pixels, never smoothed', () => {
    assert.match(readPublic('atlas.css'), /\.pet\s*\{[^}]*image-rendering:\s*pixelated/, 'a pixel sprite scaled with smoothing is a blurred sprite')
  })

  it('every width and height the pet is given is a whole multiple of its own grid', () => {
    const css = readPublic('atlas.css')
    const block = css.slice(css.indexOf('/* ---------- the pet ---------- */'), css.indexOf('/* ---------- smaller screens ---------- */'))
    const pairs = [...block.matchAll(/width:\s*(\d+)px;\s*height:\s*(\d+)px/g)]
    assert.ok(pairs.length >= 2, 'both sprites must be sized explicitly, or the page reflows when they load')
    const grids = Object.values(GRID)
    for (const [, w, h] of pairs) {
      const grid = grids.find((g) => Number(w) % g.w === 0 && Number(h) % g.h === 0 && Number(w) / g.w === Number(h) / g.h)
      assert.ok(grid, `${w}x${h} is not an integer scale of either sprite; a pixel sprite at a fractional scale is blurred`)
    }
  })

  it('the sprite markup carries its intrinsic size, so the box never grows under the reader', () => {
    const emitted: [keyof typeof GRID, string][] = [
      [FLYING, readModule('render.ts')],
      [PERCHED, readModule('figures/atlas.ts')],
    ]
    for (const [file, source] of emitted) {
      const tag = source.match(new RegExp(`<img[^>]*src="/${file}"[^>]*>`))
      assert.ok(tag, `${file} must be emitted by that module`)
      assert.match(tag[0], new RegExp(`width="${GRID[file].w}"`), `${file} must declare its own width`)
      assert.match(tag[0], new RegExp(`height="${GRID[file].h}"`), `${file} must declare its own height`)
    }
  })

  it('no landing page hard-codes the pet: it appears only where a painter decides it should', () => {
    for (const page of ['design-5.html', 'como-ler.html']) {
      assert.doesNotMatch(readPublic(page), /pet-caracara/, `${page} is markup only; the pet is a state, not furniture`)
    }
  })
})
