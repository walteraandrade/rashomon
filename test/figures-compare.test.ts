import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { seed } from './fixture.js'
import { compareParams } from '../src/ui/api.js'
import './close.js'
import { pageMarkup } from './pages.js'

// Figure 3 (issues #91, #93, #99, #293): its behaviour is test/components/compare.spec.ts. What
// stays here needs no component: the route the figure calls and the markup and CSS the page ships.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const design5 = () => pageMarkup('/')
const comoLer = () => pageMarkup('/como-ler')

describe('compareParams matches calling /api/compare directly', () => {
  it('produces the same body as calling /api/compare with kind=word,hashtag,phrase and no domain/lean', async () => {
    await seed()
    for (const [qp, direct] of [
      [compareParams({ a: 'lula', b: 'bolsonaro', days: '30', source: 'all', limit: '40' }), '/api/compare?a=lula&b=bolsonaro&days=30&source=all&limit=40&kind=word,hashtag,phrase'],
      [compareParams({ a: 'tarcisio', b: 'bolsonaro', days: '60', source: 'gdelt', limit: '20' }), '/api/compare?a=tarcisio&b=bolsonaro&days=60&source=gdelt&limit=20&kind=word,hashtag,phrase'],
    ] as const) {
      const viaHelper = await app.request('/api/compare?' + qp.toString())
      const viaDirect = await app.request(direct)
      assert.equal(viaHelper.status, 200)
      assert.deepEqual(await viaHelper.json(), await viaDirect.json())
    }
  })
})

describe('atlas.html carries the third figure card', () => {
  it('a <section class="figure ..." id="compare"> exists after #testimony, with eyebrow "Gráfico 3" and the six sentence controls', () => {
    const html = design5()
    const testimonyIdx = html.indexOf('id="testimony"')
    const compareIdx = html.indexOf('id="compare"')
    assert.ok(testimonyIdx !== -1 && compareIdx !== -1)
    assert.ok(testimonyIdx < compareIdx, '#compare must come after #testimony')
    assert.match(html, /<section class="figure[^"]*" id="compare"/)
    assert.match(html, /<span class="eyebrow">Gráfico 3<\/span>/)
    const compare = html.match(/id="compare"[\s\S]*?<\/section>/)?.[0] ?? ''
    const sentence = compare.match(/class="sentence-line">[\s\S]*?<\/p>/)?.[0] ?? ''
    for (const id of ['compareA', 'compareB', 'compareDays', 'compareSource', 'compareMeasure', 'compareLimit']) assert.match(sentence, new RegExp(`id="${id}"`), `#${id} must live in the ruler's own sentence`)
  })
})

describe('public/compare.html no longer exists', () => {
  it('the file is gone from the repository', () => {
    assert.ok(!existsSync(join(root, 'public', 'compare.html')))
  })

  it('GET /compare.html 404s', async () => {
    const res = await app.request('/compare.html')
    assert.equal(res.status, 404)
  })
})

// AC15 said the header nav link had to point at the in-page anchor with the same label. The
// link is gone instead: it pointed at an anchor on the page it was already on, which is the one
// link a page cannot usefully carry, and the ruler is the third figure down the same scroll.
describe('the header carries no in-page link to the ruler', () => {
  it('neither page names it', () => {
    assert.doesNotMatch(design5(), /compare-link|comparar pessoas/)
    assert.doesNotMatch(comoLer(), /compare-link|comparar pessoas/)
  })
})

describe('como-ler.html explains the ruler under #comparar', () => {
  it('carries an anchor id="comparar" explaining position, area and the middle pile', () => {
    const html = comoLer()
    assert.match(html, /id="comparar"/)
    const section = html.match(/<div id="comparar">[\s\S]*?<\/div>/)?.[0] ?? ''
    assert.ok(section, 'the #comparar section must exist')
    assert.match(section, /posição/i, 'must explain that position is who the word belongs to')
    assert.match(section, /de quem/i)
    assert.match(section, /tamanho/i, 'must explain that area is documents summed')
    assert.match(section, /document/i)
    assert.match(section, /somad/i)
    assert.match(section, /dividida/i, 'must explain the middle pile as a divided word')
  })
})

describe('atlas.css styles words, not dots (issue #99 AC7)', () => {
  it('carries the ruler word rules and no longer carries the dot rules', () => {
    const css = readFileSync(join(root, 'public', 'atlas.css'), 'utf8')
    assert.match(css, /\.ruler-text \{/)
    // Neither the cursor nor the pick repaints the word: the box behind it carries both, in the
    // word's own side colour, at two strengths. A selected word painted --accent threw away the
    // side it leans to, which is the only thing this figure draws.
    assert.match(css, /\.ruler-text \{[^}]*fill:\s*var\(--wc\)/)
    assert.match(css, /\.ruler-word\.is-selected \.ruler-hit \{[^}]*var\(--wc-soft\)/)
    // No outline on a mark, anywhere: this site draws no borders, so hover and pick are a wash
    // the word sits on, at two strengths, never a box drawn around it.
    for (const rule of css.match(/\.(?:ruler-hit|ruler-glow|atlas-hit|atlas-glow|center-hit|dot-halo)[^{]*\{[^}]*\}/g) ?? []) assert.doesNotMatch(rule, /stroke/, rule)
    // Core plus penumbra: one uniformly blurred rectangle is fog, and fog has no edge to read.
    assert.match(css, /\.atlas-glow, \.ruler-glow \{[^}]*blur\((\d+)px\)/)
    assert.match(css, /\.atlas-hit, \.ruler-hit \{[^}]*blur\((\d+)px\)/)
    assert.doesNotMatch(css, /\.ruler-word:hover \.ruler-text/, 'the cursor must not repaint the word')
    assert.doesNotMatch(css, /\.ruler-word\.is-selected \{[^}]*--wc:\s*var\(--accent\)/, 'nor must the pick')
    assert.match(css, /\.ruler-overflow \{/)
    assert.doesNotMatch(css, /\.ruler-dot/, 'nothing draws a ruler dot any more')
  })
})

describe('figure 3 as a Svelte component (#293)', () => {
  it('the page renders Compare.svelte and still ships every id and hook figure 3 had', () => {
    const html = design5()
    for (const id of ['compareTitle', 'compareA', 'compareB', 'compareDays', 'compareSource', 'compareMeasure', 'compareLimit', 'compareStatus', 'compareRuler', 'compareDetail', 'compareHiddenNote'])
      assert.match(html, new RegExp(`id="${id}"`), `#${id}`)
    assert.ok(existsSync(join(root, 'src', 'ui', 'Compare.svelte')))
    assert.ok(existsSync(join(root, 'src', 'ui', 'Ruler.svelte')))
  })
})
