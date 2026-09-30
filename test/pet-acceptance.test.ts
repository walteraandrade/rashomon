import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as appModule from '../src/ui/app.js'
import { clearScopes } from '../src/ui/state.js'
import { flush, withFiguresDom } from './fake-mount-dom.js'
import './close.js'
import { pageSource, siteFile } from './pages.js'

// The pet: one pixel sprite, allowed in exactly two boxes and nowhere else. The site draws every
// other limit with type, so the rule this file pins is not "the bird looks nice" but "the bird is
// only ever where a graph is absent, and only one of it at a time".

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const readPublic = (name: string) => siteFile(name)
// The front-end modules are TypeScript under src/ui; only the built bundle lives in public/.
const readModule = (name: string) => readFileSync(join(root, 'src', 'ui', name), 'utf8')

const FLYING = 'pet-caracara.png'
const PERCHED = 'pet-caracara-perched.png'

// The sprites' own pixel grids. Every width the CSS may use is an integer multiple of these.
const GRID = { [FLYING]: { w: 106, h: 78 }, [PERCHED]: { w: 26, h: 37 } }

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

// Figure 1's outage (the perched bird, the retry button, the no-fiction caveat) is Atlas.svelte's own
// and is pinned in test/components/atlas.spec.ts.
describe('the pet: the outage in figure 3', () => {
  it('figure 3 prints the outage in words only: a bird beyond the two boxes would read as decoration', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        calls.push(String(input))
        throw new Error('network down')
      }) as typeof fetch
      await withLocation(async () => {
        await appModule.boot()
        await flush()
        assert.doesNotMatch(els.compareDetail.innerHTML, /<img/, 'figure 3 states the outage in words')
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
      [FLYING, readModule('Testimony.svelte')],
      [PERCHED, readModule('Atlas.svelte')],
    ]
    for (const [file, source] of emitted) {
      const tag = source.match(new RegExp(`<img[^>]*src="/${file}"[^>]*>`))
      assert.ok(tag, `${file} must be emitted by that module`)
      assert.match(tag[0], new RegExp(`width="${GRID[file].w}"`), `${file} must declare its own width`)
      assert.match(tag[0], new RegExp(`height="${GRID[file].h}"`), `${file} must declare its own height`)
    }
  })

  it('no landing page hard-codes the pet: it appears only where a painter decides it should', () => {
    for (const page of ['atlas.html', 'como-ler.html']) {
      assert.doesNotMatch(pageSource(page), /pet-caracara/, `${page} is markup only; the pet is a state, not furniture`)
    }
  })
})
