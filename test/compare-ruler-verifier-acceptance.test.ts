import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { persons, seed } from './fixture.js'
import { clearScopes } from '../src/ui/state.js'
import { compareParams } from '../src/ui/api.js'
import { balanceColor, SCALE_MID } from '../src/ui/format.js'
import { paintCompareDetail, paintRuler, rulerTerms } from '../src/ui/render.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import './close.js'
import type { Compare, CompareTerm } from '../src/ui/format.js'

// The injected text measurer paintRuler hands to layout.js, the same contract public/js/layout.js
// documents: deterministic here, a real canvas in the browser. 0.6em per character is close
// enough to Instrument Sans that a word's box is the right order of magnitude.
const metrics = (text: string, size: number) => text.length * size * 0.6

// Independent verification of issue #91's numbered acceptance criteria (spec §5), written
// from the approved spec rather than from public/js/figures/compare.js or
// test/compare-figure-acceptance.test.ts, the tests the builder committed alongside it.
// Different people, different terms, different sample points throughout, so a bug that
// happens to satisfy the builder's own fixtures would not automatically satisfy these too.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const design5 = () => readFileSync(join(root, 'public', 'design-5.html'), 'utf8')
const comoLer = () => readFileSync(join(root, 'public', 'como-ler.html'), 'utf8')
const compareSource = () => readFileSync(join(root, 'src', 'ui', 'figures', 'compare.ts'), 'utf8')
const jsFiles = () => ({
  testimony: readFileSync(join(root, 'src', 'ui', 'figures', 'testimony.ts'), 'utf8'),
  atlas: readFileSync(join(root, 'src', 'ui', 'figures', 'atlas.ts'), 'utf8'),
})

const geraldo = { id: 'geraldo', name: 'Geraldo' }
const simone = { id: 'simone', name: 'Simone' }
const people = [geraldo, simone]

const compareData = (terms: CompareTerm[], a = geraldo, b = simone): Compare => ({
  days: 30,
  a: { person: a, about: 7 },
  b: { person: b, about: 3 },
  terms,
})

// ---------- AC1 ----------

describe('AC1: figures/compare.js is importable outside a browser and exports exactly mount', async () => {
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document defined at import time')
  const mod = await import('../src/ui/figures/compare.js')

  it('does not touch document at import time', () => {
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/compare.js must not touch document')
  })

  it('exports exactly one member: mount, a function', () => {
    assert.deepEqual(Object.keys(mod), ['mount'])
    assert.equal(typeof mod.mount, 'function')
  })
})

// ---------- AC2 ----------

describe('AC2: figures/compare.js declares exactly the import list the spec gives, and no sibling figure ever reaches into it', () => {
  const importsOf = (source: string) => [...source.matchAll(/(?:^|\n)(?:import\b|export\s*\{)[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

  it('figures/compare.js imports exactly api.js, docs-card.js, format.js, render.js, state.js (no direct layout.js)', () => {
    const resolved = importsOf(compareSource()).map((spec) => (spec.startsWith('../') ? `.${spec.slice(2)}` : spec))
    assert.deepEqual(resolved.sort(), ['./api.js', './docs-card.js', './format.js', './render.js', './state.js'])
  })

  it('app.js imports all three figure mounts, including figures/compare.js', () => {
    const appSrc = readFileSync(join(root, 'src', 'ui', 'app.ts'), 'utf8')
    assert.deepEqual(
      importsOf(appSrc).sort(),
      ['./docs-card.js', './figures/atlas.js', './figures/testimony.js', './figures/compare.js'].sort(),
    )
  })

  it('neither figures/atlas.js nor figures/testimony.js imports figures/compare.js', () => {
    const { atlas, testimony } = jsFiles()
    assert.ok(!/figures\/compare\.js/.test(atlas), 'figures/atlas.js must not import figures/compare.js')
    assert.ok(!/figures\/compare\.js/.test(testimony), 'figures/testimony.js must not import figures/compare.js')
  })
})

// ---------- AC3 ----------

describe('AC3: compareParams/loadCompare resolve to the same body as calling GET /api/compare directly', () => {
  it('kind=word,hashtag,phrase is always sent, no domain/lean ever appear on the built URLSearchParams', async () => {
    const qp = compareParams({ a: 'tarcisio', b: 'bolsonaro', days: '30', source: 'all', limit: '40' })
    assert.equal(qp.get('kind'), 'word,hashtag,phrase')
    assert.equal(qp.has('domain'), false)
    assert.equal(qp.has('lean'), false)
  })

  it('the exact query string produces the same body as the documented parameters', async () => {
    await seed()
    const qp = compareParams({ a: 'tarcisio', b: 'bolsonaro', days: '365', source: 'gdelt', limit: '20' })
    const viaHelper = await app.request('/api/compare?' + qp.toString())
    const viaDirect = await app.request('/api/compare?a=tarcisio&b=bolsonaro&days=365&source=gdelt&limit=20&kind=word,hashtag,phrase')
    assert.equal(viaHelper.status, 200)
    assert.deepEqual(await viaHelper.json(), await viaDirect.json())
  })
})

// ---------- AC4 ----------

describe('AC4: format.js exports balanceColor, a red/grey-analogue two-hue ramp', () => {
  const rgbOf = (color: string) => {
    if (color.startsWith('#')) {
      const n = parseInt(color.slice(1), 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color)!
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  const midRgb = rgbOf(SCALE_MID)
  const dist = (color: string) => rgbOf(color).reduce((sum, v, i) => sum + Math.abs(v - midRgb[i]), 0)

  it('balanceColor(0) is exactly SCALE_MID', () => {
    assert.equal(balanceColor(0), SCALE_MID)
  })

  it('balanceColor(-1) and balanceColor(1) are distinct and neither equals the grey midpoint', () => {
    const left = balanceColor(-1)
    const right = balanceColor(1)
    assert.notEqual(left, right)
    assert.notEqual(left, SCALE_MID)
    assert.notEqual(right, SCALE_MID)
  })

  it('is monotonic in |balance| on the negative side and on the positive side', () => {
    const negatives = [0, -0.2, -0.4, -0.6, -0.8, -1].map((b) => dist(balanceColor(b)))
    const positives = [0, 0.2, 0.4, 0.6, 0.8, 1].map((b) => dist(balanceColor(b)))
    for (let i = 1; i < negatives.length; i++) assert.ok(negatives[i] >= negatives[i - 1], `negative side must move away from SCALE_MID monotonically: ${negatives}`)
    for (let i = 1; i < positives.length; i++) assert.ok(positives[i] >= positives[i - 1], `positive side must move away from SCALE_MID monotonically: ${positives}`)
  })
})

// ---------- AC5 ----------

describe('AC5: balance is exactly -1/+1 for a one-sided term and 0 for an identical-both-sides term', () => {
  it('under measure: count, an a-only term is -1 and a b-only term is +1', () => {
    const terms: CompareTerm[] = [
      { term: 'estabilidade', kind: 'word', a: { count: 9, pmi: 1.4, tone: null }, b: null },
      { term: 'commodities', kind: 'word', a: null, b: { count: 6, pmi: 2.1, tone: null } },
    ]
    const { items } = rulerTerms(terms, 'count')
    assert.equal(items.find((t) => t.term === 'estabilidade')!.balance, -1)
    assert.equal(items.find((t) => t.term === 'commodities')!.balance, 1)
  })

  it('a term with identical {count, pmi} on both sides is 0, under both count and pmi', () => {
    const terms: CompareTerm[] = [{ term: 'geopolitica', kind: 'word', a: { count: 3, pmi: 0.9, tone: null }, b: { count: 3, pmi: 0.9, tone: null } }]
    assert.equal(rulerTerms(terms, 'count').items[0].balance, 0)
    assert.equal(rulerTerms(terms, 'pmi').items[0].balance, 0)
  })

  // Spec §3 as amended on issue #91 after this branch's first validation round. The formula
  // originally written there — balance = (scoreOf(b) − scoreOf(a)) / mag, unclamped — sends a
  // term whose two sides carry opposite-signed pmi to exactly ±1, because rawB − rawA
  // telescopes to |rawA| + |rawB| = mag whenever the signs differ. Measured against the real
  // corpus (lula × bolsonaro, days=365, limit=100): 141 of the 232 terms with documents on
  // BOTH sides landed on a literal end, under an axis labelled "Só de <Nome>". A word the
  // other person has 14 documents of is not that person's exclusive word, so the amended rule
  // clamps each side's score at zero before differencing. The cost, stated: a side that
  // actively repels a term (negative pmi) and a side merely indifferent to it now share a
  // position. Both exact numbers stay on the detail line, where the reader can still tell them
  // apart.
  it('a term present on both sides never reaches a literal end, even with opposite-signed pmi', () => {
    const a = { count: 40, pmi: 0.3, tone: null }
    const b = { count: 5, pmi: -2.1, tone: null }
    const terms: CompareTerm[] = [{ term: 'divergente', kind: 'word', a, b }]
    const score = (n: { count: number; pmi: number }) => n.pmi * Math.log1p(n.count)
    const mag = Math.abs(score(a)) + Math.abs(score(b))
    const expected = (Math.max(0, score(b)) - Math.max(0, score(a))) / mag
    const actual = rulerTerms(terms, 'pmi').items[0].balance
    assert.equal(actual, expected, 'each side is clamped at zero before differencing')
    assert.ok(actual > -1 && actual < 1, `a term with documents on both sides must stay off the ends, got ${actual}`)
    assert.ok(actual < 0, 'it still leans toward the side with the positive relationship')
  })

  it('an end is reachable only when one side has no documents at all', () => {
    const onlyA: CompareTerm[] = [{ term: 'exclusiva', kind: 'word', a: { count: 3, pmi: -0.9, tone: null }, b: null }]
    assert.equal(rulerTerms(onlyA, 'pmi').items[0].balance, -1, "a one-sided term pins to that side's end whatever its pmi sign")
    const bothSides: CompareTerm[] = [
      { term: 'compartilhada', kind: 'word', a: { count: 300, pmi: 4, tone: null }, b: { count: 1, pmi: -5, tone: null } },
    ]
    const balance = rulerTerms(bothSides, 'pmi').items[0].balance
    assert.ok(balance > -1, `a term with one document on the other side must not read as exclusive, got ${balance}`)
  })
})

// ---------- AC6 ----------

describe('AC6: the measure control changes position but never the combined document count', () => {
  it('combined is identical under count and pmi for every term; balance moves for at least one', () => {
    const terms: CompareTerm[] = [
      { term: 'trigo', kind: 'word', a: { count: 30, pmi: 0.08, tone: null }, b: { count: 4, pmi: 6.5, tone: null } },
      { term: 'porto', kind: 'word', a: { count: 2, pmi: 0.4, tone: null }, b: null },
    ]
    const byCount = rulerTerms(terms, 'count')
    const byPmi = rulerTerms(terms, 'pmi')
    assert.deepEqual(
      byCount.items.map((t) => t.combined),
      byPmi.items.map((t) => t.combined),
      'combined must never depend on measure',
    )
    const cBalance = byCount.items.find((t) => t.term === 'trigo')!.balance
    const pBalance = byPmi.items.find((t) => t.term === 'trigo')!.balance
    assert.notEqual(cBalance, pBalance, 'balance must move with measure for a term whose count/pmi ratio differs across sides')
  })
})

// ---------- AC7 ----------

describe('AC7: a term where either side is the string "name" is dropped from the rendered set', () => {
  it('rulerTerms excludes it from items and counts it as hidden, for either side', () => {
    const terms: CompareTerm[] = [
      { term: 'Geraldo', kind: 'word', a: 'name', b: { count: 2, pmi: 1, tone: null } },
      { term: 'Simone', kind: 'word', a: { count: 4, pmi: 1, tone: null }, b: 'name' },
      { term: 'porto', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: { count: 1, pmi: 1, tone: null } },
    ]
    const { items, hiddenCount } = rulerTerms(terms, 'count')
    assert.equal(hiddenCount, 2)
    assert.deepEqual(items.map((t) => t.term).sort(), ['porto'])
  })

  it('paintRuler paints no dot for the name terms and reports the same hiddenCount', async () => {
    await withFiguresDom(async (els) => {
      const terms: CompareTerm[] = [
        { term: 'Geraldo', kind: 'word', a: 'name', b: { count: 2, pmi: 1, tone: null } },
        { term: 'porto', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: { count: 1, pmi: 1, tone: null } },
      ]
      const { hiddenCount } = paintRuler({ data: compareData(terms), personA: geraldo, personB: simone, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.equal(hiddenCount, 1)
      assert.doesNotMatch(els.compareRuler.innerHTML, /data-term="Geraldo"/)
      assert.match(els.compareRuler.innerHTML, /data-term="porto"/)
    })
  })
})

// ---------- AC8 ----------

describe('AC8: the hidden-name note is absent when the dropped count is zero, present with the exact count otherwise', () => {
  it('stays hidden when nothing was dropped', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([{ term: 'porto', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null }]) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush(60)
      assert.equal(els.compareHiddenNote.hidden, true)
    })
  })

  it('shows the exact dropped count when two own-name terms were filtered', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const terms: CompareTerm[] = [
        { term: 'Geraldo', kind: 'word', a: 'name', b: { count: 1, pmi: 1, tone: null } },
        { term: 'Simone', kind: 'word', a: { count: 1, pmi: 1, tone: null }, b: 'name' },
        { term: 'porto', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: { count: 1, pmi: 1, tone: null } },
      ]
      routeFetch(calls, { '/compare': compareData(terms) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush(60)
      assert.equal(els.compareHiddenNote.hidden, false)
      assert.match(els.compareHiddenNote.textContent, /\b2\b/)
    })
  })
})

// ---------- AC9 ----------

describe('AC9: the same-person notice shows exactly when a === b', () => {
  it('design-5.html carries the exact same-person sentence, initially hidden', () => {
    assert.match(design5(), /<p class="status" id="compareStatus"[^>]*hidden[^>]*>Os dois lados mostram a mesma pessoa\.<\/p>|<p class="status" id="compareStatus"[^>]*>Os dois lados mostram a mesma pessoa\.<\/p>/)
  })

  it('#compareStatus becomes visible when the resolved a equals b', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([], geraldo, geraldo) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush(60)
      assert.equal(els.compareStatus.hidden, false)
    })
  })

  it('#compareStatus stays hidden when a and b differ', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([], geraldo, simone) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush(60)
      assert.equal(els.compareStatus.hidden, true)
    })
  })
})

// ---------- AC10 ----------

describe('AC10: clicking a dot fills the detail line, and clicking it again or the background clears it', () => {
  it('a null side reads "nenhum documento", never "0 documentos", and both names appear', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([{ term: 'porto', kind: 'word', a: { count: 8, pmi: 0.6, tone: null }, b: null }]) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush(60)
      const [dot] = els.compareRuler.querySelectorAll('[data-term]')
      assert.ok(dot, 'the ruler must render one clickable dot')
      dot.fire('click')
      assert.match(els.compareDetail.innerHTML, /Geraldo/)
      assert.match(els.compareDetail.innerHTML, /<dt>Simone<\/dt><dd class="empty-hint">nenhum documento<\/dd>/)
      assert.doesNotMatch(els.compareDetail.innerHTML, /0 documentos/)
    })
  })

  it('clicking the same dot again releases the selection back to the empty hint', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([{ term: 'porto', kind: 'word', a: { count: 8, pmi: 0.6, tone: null }, b: null }]) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush(60)
      let dot = els.compareRuler.querySelectorAll('[data-term]')[0]
      dot.fire('click')
      assert.match(els.compareDetail.innerHTML, /nenhum documento/)
      dot = els.compareRuler.querySelectorAll('[data-term]')[0]
      dot.fire('click')
      assert.match(els.compareDetail.innerHTML, /Clique numa palavra/)
    })
  })

  it('a click on the ruler background (not a dot) also releases the selection', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([{ term: 'porto', kind: 'word', a: { count: 8, pmi: 0.6, tone: null }, b: null }]) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush(60)
      const dot = els.compareRuler.querySelectorAll('[data-term]')[0]
      dot.fire('click')
      assert.match(els.compareDetail.innerHTML, /nenhum documento/)
      els.compareRuler.fire('click', {})
      assert.match(els.compareDetail.innerHTML, /Clique numa palavra/)
    })
  })
})

// ---------- AC11 ----------

describe('AC11: changing a compare control refetches only compare, and vice versa', () => {
  const cases: [string, string][] = [
    ['compareA', 'simone'],
    ['compareB', 'geraldo'],
    ['compareDays', '7'],
    ['compareLimit', '60'],
  ]
  for (const [id, value] of cases) {
    it(`changing ${id} triggers exactly one new /api/compare call`, async () => {
      await withFiguresDom(async (els, calls) => {
        clearScopes()
        routeFetch(calls, { '/compare': compareData([]) })
        const { mount } = await import('../src/ui/figures/compare.js')
        mount(els.compare, { people, initial: {} })
        await flush(60)
        const before = calls.length
        ;(els as unknown as Record<string, { value: string; fire: (t: string) => void }>)[id].value = value
        ;(els as unknown as Record<string, { value: string; fire: (t: string) => void }>)[id].fire('change')
        await flush(220)
        const added = calls.slice(before)
        assert.equal(added.filter((u) => u.includes('/api/compare')).length, 1, `expected exactly one /api/compare call for ${id}: ${JSON.stringify(added)}`)
      })
    })
  }

  it('changing figure 2 (testimony)\'s own control never triggers a compare fetch, and vice versa', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/sources': [],
        '/testimony': { method: 'kikori', overall: { score: null, n: 0 }, by_source: [], by_domain: [] },
        '/compare': compareData([]),
      })
      const { mount: mountCompare } = await import('../src/ui/figures/compare.js')
      const { mount: mountTestimony } = await import('../src/ui/figures/testimony.js')
      mountTestimony(els.testimony, { people, initial: {} })
      mountCompare(els.compare, { people, initial: {} })
      await flush(60)

      const beforeTestimony = calls.length
      els.testimonyDays.value = '365'
      els.testimonyDays.fire('change')
      await flush(220)
      const addedByTestimony = calls.slice(beforeTestimony)
      assert.ok(addedByTestimony.some((u) => u.includes('/sources') || u.includes('/testimony')), 'figure 2 must reload on its own control')
      assert.ok(!addedByTestimony.some((u) => u.includes('/api/compare')), `figure 3 must not reload when figure 2 changes: ${JSON.stringify(addedByTestimony)}`)

      const beforeCompare = calls.length
      els.compareDays.value = '365'
      els.compareDays.fire('change')
      await flush(220)
      const addedByCompare = calls.slice(beforeCompare)
      assert.ok(addedByCompare.some((u) => u.includes('/api/compare')), 'figure 3 must reload on its own control')
      assert.ok(!addedByCompare.some((u) => u.includes('/sources') || u.includes('/testimony')), `figure 2 must not reload when figure 3 changes: ${JSON.stringify(addedByCompare)}`)
    })
  })
})

// ---------- AC12 ----------

describe('AC12: no word rendered by the ruler ever opens #docsDialog', () => {
  it('figures/compare.js never references docsDialog outside a comment', () => {
    const code = compareSource()
      .split('\n')
      .map((line) => line.replace(/\/\/.*/, ''))
      .join('\n')
    assert.doesNotMatch(code, /docsDialog/)
  })

  it('a rendered dot carries no data-docs-open attribute and paintCompareDetail emits no link or button', async () => {
    await withFiguresDom(async (els) => {
      const data = compareData([{ term: 'porto', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null }])
      paintRuler({ data, personA: geraldo, personB: simone, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.doesNotMatch(els.compareRuler.innerHTML, /data-docs-open/)
      assert.doesNotMatch(els.compareRuler.innerHTML, /docsDialog/)

      paintCompareDetail({ term: { term: 'porto', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null }, personA: geraldo, personB: simone })
      assert.doesNotMatch(els.compareDetail.innerHTML, /docsDialog/)
      assert.doesNotMatch(els.compareDetail.innerHTML, /<a\b/)
      assert.doesNotMatch(els.compareDetail.innerHTML, /<button\b/)
    })
  })
})

// ---------- AC13 ----------

describe('AC13: design-5.html carries the third figure card, after #testimony', () => {
  it('has id="compare", eyebrow "Gráfico 3" and the six sentence controls', () => {
    const html = design5()
    const testimonyIdx = html.indexOf('id="testimony"')
    const compareIdx = html.indexOf('id="compare"')
    assert.ok(testimonyIdx !== -1 && compareIdx !== -1 && testimonyIdx < compareIdx, '#compare must come after #testimony')
    assert.match(html, /<section class="figure[^"]*"\s+id="compare"/)
    const section = html.match(/id="compare"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(section, /<span class="eyebrow">Gráfico 3<\/span>/)
    const sentence = section.match(/class="sentence-line">[\s\S]*?<\/p>/)?.[0] ?? ''
    for (const id of ['compareA', 'compareB', 'compareDays', 'compareSource', 'compareMeasure', 'compareLimit']) {
      assert.match(sentence, new RegExp(`id="${id}"`), `#${id} must live in figure 3's own sentence`)
    }
  })
})

// ---------- AC14 ----------

describe('AC14: public/compare.html no longer exists', () => {
  it('is gone from the repository and 404s over HTTP', async () => {
    assert.ok(!existsSync(join(root, 'public', 'compare.html')))
    const res = await app.request('/compare.html')
    assert.equal(res.status, 404)
  })
})

// ---------- AC15 ----------

describe('AC15: the header nav link points at the in-page anchor', () => {
  it('the header carries no in-page link to the ruler', () => {
    assert.doesNotMatch(design5(), /compare-link|comparar pessoas/)
  })
})

// ---------- AC16 ----------

describe('AC16: como-ler.html explains the ruler under #comparar', () => {
  it('explains position (who the word is), area (documents summed) and the middle pile (divided)', () => {
    const html = comoLer()
    assert.match(html, /id="comparar"/)
    const section = html.match(/<div id="comparar">[\s\S]*?<\/div>\s*<\/div>|<div id="comparar">[\s\S]*?<\/div>/)?.[0] ?? ''
    assert.ok(section, 'the #comparar section must exist')
    assert.match(section, /posi[cç][aã]o/i, 'must explain position')
    assert.match(section, /de quem/i, 'must explain position names whose word it is')
    assert.match(section, /document/i, 'must mention documents for the area')
    assert.match(section, /somad/i, 'must say the documents are summed')
    assert.match(section, /dividid/i, 'must explain the middle pile as a divided word')
  })
})

describe('sanity: the compare pair used across this file is genuinely two distinct people', () => {
  it('geraldo and simone have different ids', () => {
    assert.notEqual(geraldo.id, simone.id)
  })
  it('the /api/compare fixture people are actually tracked in seed data used by AC3 (tarcisio, bolsonaro)', () => {
    assert.ok(persons.some((p) => p.id === 'tarcisio'))
    assert.ok(persons.some((p) => p.id === 'bolsonaro'))
  })
})
