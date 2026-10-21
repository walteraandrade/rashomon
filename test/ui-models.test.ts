import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { butterflyRows } from '../src/ui/butterfly-model.js'
import { THIN_ABOUT, compareModeFor, thinNoteText } from '../src/ui/compare-model.js'
import { rankedRows } from '../src/ui/strip-model.js'
import { axisTicks, dumbbellModel, hasShares, rareRisers, ratioLabel, ratioText, shareBalance, type CompareTerm, type Rising, type RisingTerm } from '../src/ui/format.js'

// The pure models behind the figures (compare-model, strip-model, format's rising helpers) and the
// stylesheet rules the figures rely on. Nothing here fetches.


describe('rankedRows: the outlets as ranked dots (issue #331)', () => {
  const row = (domain: string, score: number, n: number, source = 'gnews') => ({ domain, source, score, n })
  const many = (count: number) => Array.from({ length: count }, (_, i) => row(`o${String(i).padStart(2, '0')}.example`, (i % 7) - 3, 100 - i))

  it('rankedRows: caps at 20 in folded order', () => {
    const model = rankedRows(many(25), 860)
    assert.equal(model.rows.length, 20)
    assert.deepEqual(model.rows.map((r) => r.n), Array.from({ length: 20 }, (_, i) => 100 - i), 'largest n first')
    assert.ok(model.rows.every((r, i) => i === 0 || r.y - model.rows[i - 1].y === 22), '22 px pitch')
    assert.equal(rankedRows(many(3), 860).rows.length, 3, 'fewer than 20 draws them all')
    assert.deepEqual(rankedRows([], 860).rows, [])
    assert.deepEqual(rankedRows(many(25), 860).rows, rankedRows(many(25), 860).rows, 'deterministic')
  })

  it('rankedRows: folds a domain seen under several sources into one n-weighted row', () => {
    const model = rankedRows([row('a.example', -2, 10, 'gnews'), row('a.example', 4, 30, 'bluesky'), row('b.example', 0, 5)], 860)
    assert.equal(model.rows.length, 2)
    assert.equal(model.rows[0].domain, 'a.example')
    assert.equal(model.rows[0].n, 40)
    assert.equal(model.rows[0].score, (-2 * 10 + 4 * 30) / 40)
    assert.deepEqual(model.rows[0].sources, ['gnews', 'bluesky'])
  })

  it('rankedRows: clamps the axis at +-5 and flags clipped', () => {
    const model = rankedRows([row('hi.example', 7, 9), row('lo.example', -7, 8), row('edge.example', 5, 7), row('lowedge.example', -5, 6), row('zero.example', 0, 5)], 860, -8)
    const by = (d: string) => model.rows.find((r) => r.domain === d)!
    assert.equal(model.x(-5), model.plot.left)
    assert.equal(model.x(5), model.plot.right)
    assert.equal(model.x(0), (model.plot.left + model.plot.right) / 2)
    assert.equal(model.x(9), model.x(5))
    assert.equal(by('hi.example').clipped, 1)
    assert.equal(by('lo.example').clipped, -1)
    assert.equal(by('edge.example').clipped, 0, 'exactly +5 is not clipped')
    assert.equal(by('lowedge.example').clipped, 0, 'exactly -5 is not clipped')
    assert.equal(by('zero.example').clipped, 0)
    assert.equal(by('hi.example').x, model.x(5))
    assert.equal(by('lo.example').x, model.plot.left)
    assert.equal(by('hi.example').score, 7, 'the real value stays')
    assert.deepEqual(model.mean, { x: model.plot.left, clipped: -1 })
    assert.equal(model.zero, model.x(0))
    assert.deepEqual(model.ticks.map((t) => t.label), ['−5', '−2,5', '0', '+2,5', '+5'])
    assert.deepEqual(model.ticks.map((t) => t.x), [-5, -2.5, 0, 2.5, 5].map(model.x))
  })

  it('rankedRows: radius is a sqrt scale between 3 and 9', () => {
    const model = rankedRows([row('a.example', 0, 400), row('b.example', 0, 100), row('c.example', 0, 3)], 860)
    const r = (d: string) => model.rows.find((x) => x.domain === d)!.r
    assert.equal(r('a.example'), 9)
    assert.ok(Math.abs(r('b.example') - 6) < 0.01, 'a quarter of the largest n is radius 6')
    assert.ok(model.rows.every((x) => x.r >= 3 && x.r <= 9))
    assert.equal(rankedRows([row('only.example', 1, 3)], 860).rows[0].r, 9, 'a lone row is its own maximum')
  })

  it('rankedRows: mean is null without a score', () => {
    assert.equal(rankedRows(many(2), 860).mean, null)
    assert.equal(rankedRows(many(2), 860, null).mean, null)
    assert.deepEqual(rankedRows(many(2), 860, 0).mean, { x: rankedRows([], 860).zero, clipped: 0 })
  })

  it('rankedRows: label column shrinks to 96 and the svg stops at 420', () => {
    const narrow = rankedRows(many(2), 320)
    assert.equal(narrow.labelCol, 96)
    assert.equal(narrow.svgWidth, 420)
    assert.equal(narrow.width, 420)
    assert.equal(narrow.plot.left, 96)
    assert.equal(narrow.plot.right, 420 - 56)
    assert.equal(rankedRows(many(2), 400).svgWidth, 420)
    assert.equal(rankedRows(many(2), 1000).labelCol, 220, '0.28 * 1000 is clamped')
    assert.equal(rankedRows(many(2), 1000).svgWidth, 1000)
    assert.equal(rankedRows(many(2), 500).labelCol, 140)
  })

  it('rankedRows: truncates a label by the 0.6 em rule', () => {
    const rows = [row('twelve12.com', 0, 9), row('thirteen13.com', 0, 8), row('a-very-long-domain-name.example.com', 0, 7)]
    const narrow = rankedRows(rows, 320)
    assert.deepEqual(narrow.rows.map((r) => r.label), ['twelve12.com', 'thirteen13.…', 'a-very-long…'])
    assert.deepEqual(narrow.rows.map((r) => r.truncated), [false, true, true])
    const wide = rankedRows([row('twenty-five-characters.example', 0, 3), row('x'.repeat(25), 0, 2)], 1000)
    assert.equal(wide.rows[1].label, 'x'.repeat(25), 'a 25-character domain fits 220 px')
    assert.equal(wide.rows[1].truncated, false)
    assert.equal(wide.rows[0].label, 'twenty-five-characters.examp…', '29 characters fit 212 px, so a 30-character domain keeps 28 and the ellipsis')
  })
})

describe('the six --theme-* tokens are distinct and readable (issue #217 AC14)', () => {
  const cssRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const cssPath = join(cssRoot, 'public', 'atlas.css')
  const css = readFileSync(cssPath, 'utf8')
  const hexOf = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]

  const srgbToLinear = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const luminance = (hex: string) => {
    const n = hex.replace('#', '')
    const r = parseInt(n.slice(0, 2), 16)
    const g = parseInt(n.slice(2, 4), 16)
    const b = parseInt(n.slice(4, 6), 16)
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  const hexToHue = (hex: string) => {
    const n = hex.replace('#', '')
    const r = parseInt(n.slice(0, 2), 16) / 255
    const g = parseInt(n.slice(2, 4), 16) / 255
    const b = parseInt(n.slice(4, 6), 16) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max === min) return 0
    const d = max - min
    const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return h * 60
  }
  const hueDistance = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360
    return Math.min(d, 360 - d)
  }

  it('atlas.css declares --theme-1..--theme-6, each meeting 4.5:1 against --bg (issue #217 AC14)', () => {
    const bg = hexOf('bg')
    assert.ok(bg, '--bg must be declared')
    const themeHexes = [1, 2, 3, 4, 5, 6].map((i) => hexOf(`theme-${i}`))
    for (const [i, hex] of themeHexes.entries()) {
      assert.ok(hex, `--theme-${i + 1} must be declared as a hex colour`)
      assert.ok(contrast(hex as string, bg as string) >= 4.5, `--theme-${i + 1} (${hex}) must meet 4.5:1 against --bg (${bg})`)
    }
  })

  it('the six --theme-* tokens are pairwise distinct, and distinct from --hostile/--favor/--cmp-a/--cmp-b (issue #217 AC14)', () => {
    const named = { hostile: hexOf('hostile'), favor: hexOf('favor'), 'cmp-a': hexOf('cmp-a'), 'cmp-b': hexOf('cmp-b') }
    for (const [k, v] of Object.entries(named)) assert.ok(v, `--${k} must be declared`)
    const themes = [1, 2, 3, 4, 5, 6].map((i) => [`theme-${i}`, hexOf(`theme-${i}`)] as const)
    const all = [...Object.entries(named), ...themes]
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const [nameA, hexA] = all[i]
        const [nameB, hexB] = all[j]
        if (nameA.startsWith('theme-') && nameB.startsWith('theme-')) {
          assert.notEqual(hexA, hexB, `${nameA} and ${nameB} must not share a colour`)
        } else if (nameA.startsWith('theme-') || nameB.startsWith('theme-')) {
          assert.notEqual(hexA, hexB, `${nameA} and ${nameB} must not share a colour`)
        }
      }
    }
  })

  it('every --theme-* token sits at least 30° of hue away from --accent, so none reads as the live control (code review fix #3)', () => {
    const accent = hexOf('accent')
    assert.ok(accent, '--accent must be declared')
    const accentHue = hexToHue(accent as string)
    for (const i of [1, 2, 3, 4, 5, 6]) {
      const hex = hexOf(`theme-${i}`)
      assert.ok(hex, `--theme-${i} must be declared`)
      const d = hueDistance(hexToHue(hex as string), accentHue)
      assert.ok(d >= 30, `--theme-${i} (${hex}) must sit at least 30° of hue from --accent (${accent}), got ${d.toFixed(1)}°`)
    }
  })

  it('a list dot and a scatter point fall back to --muted under both masks, so an uncoloured term never vanishes (issue #328 AC7)', () => {
    for (const [mask, token] of [['is-masked', '--mask'], ['is-themed', '--theme']]) {
      assert.match(css, new RegExp(`\\.columns\\.${mask} \\.list-dot\\s*\\{[^}]*background:\\s*var\\(${token},\\s*var\\(--muted\\)\\)`), `the list dot must keep the --muted fallback under ${mask}`)
      assert.match(css, new RegExp(`\\.scatter-svg\\.${mask} \\.scatter-point[^{]*\\{[^}]*--wc:\\s*var\\(${token},\\s*var\\(--muted\\)\\)`), `the scatter must keep the --muted fallback on --wc under ${mask}`)
    }
    assert.match(css, /\.list-dot\s*\{[^}]*background:\s*var\(--muted\)/, 'a dot with no mask rule is neutral')
    assert.match(css, /\.scatter-dot\s*\{[^}]*fill:\s*var\(--wc,\s*var\(--muted\)\)/)
  })
})

// issue #151: figure 4's own pure pre-layout step, checked directly (per the issue's own test
// plan) against the exports rather than against painted markup.
const risingTerm = (over: Partial<RisingTerm> = {}): RisingTerm => ({
  term: 'x',
  kind: 'word',
  count_recent: 1,
  count_baseline: 1,
  count_recent_raw: 1,
  count_baseline_raw: 1,
  lift: 1,
  ...over,
})

describe('shareBalance clamps a word\'s share of everything written about the person (the rare list\'s colour)', () => {
  // 40 word rows this week, 16 before: a word with 5 rows now and 1 (+1 smoothing -> 2) before
  // holds 1/8 of the words in both windows.
  const about = { recent: 10, baseline: 5, words_recent: 40, words_baseline: 16 }

  it('a term whose share is unchanged sits at the centre (balance === 0)', () => {
    assert.equal(shareBalance(risingTerm({ count_recent_raw: 5, count_baseline_raw: 1 }), about), 0)
  })

  it('a share 8x bigger than before clamps to +1, 8x smaller to -1', () => {
    assert.equal(shareBalance(risingTerm({ count_recent_raw: 40, count_baseline_raw: 1 }), about), 1, 'log2(8)/3 === 1 exactly')
    assert.equal(shareBalance(risingTerm({ count_recent_raw: 40, count_baseline_raw: 0 }), { ...about, words_baseline: 5000 }), 1)
    assert.equal(shareBalance(risingTerm({ count_recent_raw: 1, count_baseline_raw: 15 }), { ...about, words_recent: 64 }), -1)
  })

  it('stays finite with no baseline words at all: everything present is new, so it reads +1', () => {
    assert.equal(shareBalance(risingTerm({ count_recent_raw: 3, count_baseline_raw: 0 }), { recent: 5, baseline: 0, words_recent: 9, words_baseline: 0 }), 1)
    assert.equal(shareBalance({ count_recent_raw: 0, count_baseline_raw: 0 }, { recent: 0, baseline: 0, words_recent: 0, words_baseline: 0 }), 0)
  })

  it('no words in the recent window reads -1, whatever the counts', () => {
    assert.equal(shareBalance({ count_recent_raw: 4, count_baseline_raw: 2 }, { recent: 0, baseline: 5, words_recent: 0, words_baseline: 9 }), -1)
  })

  it('hasShares is true only when present and both word totals arrived', () => {
    const base = { days: 7, baseline: 30, terms: [], outlets: [], about: { recent: 1, baseline: 1 } }
    assert.equal(hasShares(base), false)
    assert.equal(hasShares({ ...base, present: [] }), false)
    assert.equal(hasShares({ ...base, about: { recent: 1, baseline: 1, words_recent: 3, words_baseline: 2 } }), false)
    assert.equal(hasShares({ ...base, present: [], about: { recent: 1, baseline: 1, words_recent: 3, words_baseline: 2 } }), true)
  })

  it('rareRisers: terms minus present, only lift > 1, in the order terms came', () => {
    const present = [risingTerm({ term: 'a', lift: 4 }), risingTerm({ term: 'b', lift: 2 })]
    const terms = [risingTerm({ term: 'a', lift: 4 }), risingTerm({ term: 'c', lift: 3 }), risingTerm({ term: 'b', lift: 2 }), risingTerm({ term: 'd', lift: 1.5 }), risingTerm({ term: 'e', lift: 1 }), risingTerm({ term: 'f', lift: 0.5 })]
    assert.deepEqual(rareRisers(terms, present).map((t) => t.term), ['c', 'd'])
    assert.deepEqual(rareRisers(terms, []).map((t) => t.term), ['a', 'c', 'b', 'd'], 'lift 1 and below never counts as rising')
  })
})

const risingData = (terms: RisingTerm[], over: Partial<Rising> = {}, about: Rising['about'] = { recent: 8, baseline: 3, words_recent: 40, words_baseline: 16 }): Rising => ({
  days: 7,
  baseline: 14,
  terms,
  present: terms,
  outlets: [],
  about,
  ...over,
})
const raw = (term: string, cr: number, cb: number, kind = 'word') => risingTerm({ term, kind, count_recent_raw: cr, count_baseline_raw: cb })
const finiteOrNull = (m: ReturnType<typeof dumbbellModel>) => [m.max, ...m.ticks.map((t) => t.value), ...m.rows.flatMap((r) => [r.before, r.now, r.ratio])].every((v) => v === null || Number.isFinite(v))

describe('dumbbellModel (#327)', () => {
  it('dumbbellModel takes the 20 present terms with the most recent occurrences', () => {
    const terms = Array.from({ length: 25 }, (_, i) => raw(`t${String(i).padStart(2, '0')}`, 3 + i, 1))
    const m = dumbbellModel(risingData(terms))
    assert.equal(m.rows.length, 20)
    assert.deepEqual(new Set(m.rows.map((r) => r.term)), new Set(terms.slice(5).map((t) => t.term)))
    assert.equal(dumbbellModel(risingData(terms.slice(0, 7))).rows.length, 7)
    assert.deepEqual(dumbbellModel(risingData([])).rows, [])
  })

  it('dumbbellModel breaks a tie at the 20-row cut by term, then kind', () => {
    const terms = [...Array.from({ length: 19 }, (_, i) => raw(`a${i}`, 9, 1)), raw('zeta', 4, 1), raw('beta', 4, 1), raw('beta', 4, 1, 'hashtag')]
    const m = dumbbellModel(risingData(terms))
    assert.equal(m.rows.length, 20)
    assert.ok(m.rows.some((r) => r.term === 'beta' && r.kind === 'hashtag'), 'kind ascending breaks a tie on the same term')
    assert.ok(!m.rows.some((r) => r.term === 'beta' && r.kind === 'word'))
    assert.ok(!m.rows.some((r) => r.term === 'zeta'))
  })

  it('dumbbellModel falls back to terms ranked by recent count when present is missing', () => {
    const terms = Array.from({ length: 22 }, (_, i) => raw(`t${i}`, 3 + i, 1))
    const m = dumbbellModel(risingData(terms, { present: undefined }))
    assert.equal(m.rows.length, 20)
    assert.equal(m.unit, 'cem')
    assert.ok(!m.rows.some((r) => r.term === 't0' || r.term === 't1'))
  })

  it('dumbbellModel orders rows by smoothed share ratio, ties by recent count then term', () => {
    const m = dumbbellModel(risingData([raw('pouco', 5, 1), raw('muito', 40, 1), raw('b', 5, 1), raw('a', 5, 1), raw('mais', 6, 1)]))
    assert.deepEqual(m.rows.map((r) => r.term), ['muito', 'mais', 'a', 'b', 'pouco'])
    const tied = dumbbellModel(risingData([raw('b', 4, 1), raw('a', 4, 1), raw('c', 8, 3)], {}, { recent: 8, baseline: 3, words_recent: 40, words_baseline: 40 }))
    assert.deepEqual(tied.rows.map((r) => r.term), ['c', 'a', 'b'], 'all three smooth to 2: recent count first, then term')
  })

  it('dumbbellModel dots are per thousand words and ratio is raw now over before', () => {
    const m = dumbbellModel(risingData([raw('a', 5, 1), raw('b', 3, 9)]))
    assert.equal(m.unit, 'mil')
    const a = m.rows.find((r) => r.term === 'a')!
    assert.equal(a.now, 125)
    assert.equal(a.before, 62.5)
    assert.equal(a.ratio, 2)
    assert.equal(ratioLabel(a.ratio!), '×2,0')
    const b = m.rows.find((r) => r.term === 'b')!
    assert.equal(b.now, 75)
    assert.equal(b.before, 562.5)
    assert.equal(ratioLabel(b.ratio!), '×0,1')
    assert.equal(m.max, 562.5)
  })

  it('dumbbellModel marks a zero baseline as nova and draws no before value', () => {
    const m = dumbbellModel(risingData([raw('novo', 6, 0), raw('quase', 60, 1)]))
    const novo = m.rows.find((r) => r.term === 'novo')!
    assert.equal(novo.isNew, true)
    assert.equal(novo.before, null)
    assert.equal(novo.ratio, null)
    assert.equal(novo.now, 150)
    const quase = m.rows.find((r) => r.term === 'quase')!
    assert.equal(quase.isNew, false)
    assert.ok(quase.ratio! > 20)
  })

  it('dumbbellModel uses per-hundred-texts when a words_* total is 0 or missing', () => {
    for (const about of [{ recent: 8, baseline: 4, words_recent: 40, words_baseline: 0 }, { recent: 8, baseline: 4 }, { recent: 8, baseline: 4, words_recent: 0, words_baseline: 9 }]) {
      const m = dumbbellModel(risingData([raw('a', 2, 1)], {}, about))
      assert.equal(m.unit, 'cem')
      assert.equal(m.rows[0].now, 25)
      assert.equal(m.rows[0].before, 25)
    }
    assert.equal(dumbbellModel(risingData([raw('a', 2, 1)], { present: undefined })).unit, 'cem')
  })

  it('dumbbellModel stays finite on empty and zero-denominator payloads', () => {
    const terms = [raw('a', 3, 2), raw('b', 4, 0)]
    for (const [name, about] of Object.entries({
      none: { recent: 0, baseline: 0 },
      wordsRecent0: { recent: 5, baseline: 5, words_recent: 0, words_baseline: 9 },
      wordsBaseline0: { recent: 5, baseline: 5, words_recent: 9, words_baseline: 0 },
      baseline0: { recent: 5, baseline: 0 },
    })) {
      const m = dumbbellModel(risingData(terms, name === 'baseline0' ? { present: undefined } : {}, about))
      assert.ok(finiteOrNull(m), name)
      assert.ok(m.max > 0 && m.ticks.length >= 4, name)
    }
    const empty = dumbbellModel(risingData([]))
    assert.deepEqual(empty.rows, [])
    assert.equal(empty.max, 1)
    assert.ok(finiteOrNull(empty))
  })

  it('dumbbellModel keeps a payload with a baseline count but no baseline denominator without a ratio', () => {
    const m = dumbbellModel(risingData([raw('a', 3, 2)], { present: undefined }, { recent: 5, baseline: 0 }))
    assert.equal(m.rows[0].before, null)
    assert.equal(m.rows[0].ratio, null)
    assert.equal(m.rows[0].isNew, false)
    assert.equal(dumbbellModel(risingData([raw('a', 3, 2)], { present: undefined }, { recent: 0, baseline: 0 })).rows[0].now, null)
  })
})

describe('dumbbellModel arithmetic edges (#327)', () => {
  it('a row with no recent denominator and no baseline count has no dot at all and reads nova', () => {
    const m = dumbbellModel(risingData([raw('a', 4, 0)], {}, { recent: 0, baseline: 0 }))
    const row = m.rows[0]
    assert.equal(m.unit, 'cem')
    assert.deepEqual([row.before, row.now, row.ratio, row.isNew], [null, null, null, true])
    assert.equal(ratioText(row), 'nova')
    assert.equal(m.max, 1)
  })

  it('the axis scales to the drawn rows only, never to the terms cut off', () => {
    const drawn = Array.from({ length: 20 }, (_, i) => raw(`d${String(i).padStart(2, '0')}`, 10, 1))
    const cut = raw('fora', 2, 300)
    const m = dumbbellModel(risingData([...drawn, cut]))
    assert.ok(!m.rows.some((r) => r.term === 'fora'))
    assert.equal(m.max, Math.max(...m.rows.flatMap((r) => [r.before, r.now]).filter((v): v is number => v !== null)))
    assert.equal(m.max, 250)
  })

  it('a shrinking word keeps its before dot right of its now dot and a ratio under one', () => {
    const row = dumbbellModel(risingData([raw('caiu', 2, 10)])).rows[0]
    assert.ok(row.before! > row.now!)
    assert.ok(row.ratio! < 1)
    assert.equal(ratioText(row), '×0,1')
  })

  it('ratioText prints the dash only for a non-nova row with no ratio', () => {
    const dash = dumbbellModel(risingData([raw('a', 3, 2)], { present: undefined }, { recent: 5, baseline: 0 })).rows[0]
    assert.equal(ratioText(dash), '–')
    assert.equal(ratioText({ ...dash, isNew: true }), 'nova')
    assert.equal(ratioText({ ...dash, ratio: 3.24 }), '×3,2')
  })

  it('a hashtag and a word of the same name are two rows', () => {
    const m = dumbbellModel(risingData([raw('lula', 5, 1), raw('lula', 5, 1, 'hashtag')]))
    assert.deepEqual(m.rows.map((r) => r.kind).sort(), ['hashtag', 'word'])
  })
})

describe('ratioLabel (#327)', () => {
  it('ratioLabel prints one pt-BR decimal', () => {
    assert.equal(ratioLabel(3.2), '×3,2')
    assert.equal(ratioLabel(0.6), '×0,6')
    assert.equal(ratioLabel(1234.5), '×1.234,5')
    assert.equal(ratioLabel(0.04), '×0,0')
  })
})

describe('axisTicks (#327)', () => {
  const sweep = [0.003, 0.07, 0.3, 0.6, 0.7, 0.9, 1, 12, 37, 100, 480, 2500]

  it('axisTicks gives 4 to 6 nice ticks starting at 0 for any max', () => {
    for (const max of sweep) {
      const ticks = axisTicks(max)
      assert.ok(ticks.length >= 4 && ticks.length <= 6, `${max}: ${ticks.length} ticks`)
      assert.equal(ticks[0].value, 0)
      assert.ok(ticks.at(-1)!.value <= max + 1e-9, `${max}: last tick ${ticks.at(-1)!.value}`)
      const step = ticks[1].value
      const exp = Math.floor(Math.log10(step) + 1e-9)
      const mantissa = step / 10 ** exp
      assert.ok([1, 2, 2.5, 5].some((m) => Math.abs(m - mantissa) < 1e-9), `${max}: step ${step}`)
      ticks.forEach((t, i) => assert.ok(Math.abs(t.value - i * step) < 1e-9, `${max}: tick ${i}`))
    }
  })

  it('axisTicks values carry no floating-point residue', () => {
    for (const max of [0.003, 0.07, 0.3, 0.6, 0.7, 0.9, 1.1, 12, 37, 480]) {
      for (const t of axisTicks(max)) assert.equal(t.value, Number(t.value.toFixed(6)), `${max}: ${t.value}`)
    }
    assert.deepEqual(axisTicks(0.7).map((t) => t.value), [0, 0.2, 0.4, 0.6])
  })

  it('axisTicks takes the largest step that still gives three intervals', () => {
    assert.deepEqual(axisTicks(100).map((t) => t.value), [0, 25, 50, 75, 100])
    assert.deepEqual(axisTicks(37).map((t) => t.value), [0, 10, 20, 30])
    assert.deepEqual(axisTicks(30).map((t) => t.value), [0, 10, 20, 30])
    assert.deepEqual(axisTicks(29).map((t) => t.value), [0, 5, 10, 15, 20, 25])
  })

  it('axisTicks labels carry the decimals the step needs in pt-BR', () => {
    assert.deepEqual(axisTicks(12).map((t) => t.label), ['0,0', '2,5', '5,0', '7,5', '10,0'])
    assert.deepEqual(axisTicks(1).map((t) => t.label), ['0,00', '0,25', '0,50', '0,75', '1,00'])
    assert.deepEqual(axisTicks(2500).map((t) => t.label), ['0', '500', '1.000', '1.500', '2.000', '2.500'])
    for (const max of sweep) for (const t of axisTicks(max)) assert.doesNotMatch(t.label, /\d\.\d{1,2}$/, `${max}: ${t.label} must use the pt-BR comma`)
  })

  it('axisTicks does not throw for a max that is not positive or not finite', () => {
    for (const max of [0, -3, NaN, Infinity]) {
      const ticks = axisTicks(max)
      assert.ok(ticks.length >= 4, String(max))
      assert.ok(ticks.every((t) => Number.isFinite(t.value)))
    }
  })
})

// --accent is reserved for the live control elsewhere on the page (CLAUDE.md); the views row
// must never carry a colour rule of its own -- the row head already names the row.
describe('atlas.css never gives the attention views row --accent', () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const css = readFileSync(join(root, 'public', 'atlas.css'), 'utf8')

  it('carries no data-row="views" .attention-mark rule, and no rule anywhere in the attention block reads var(--accent)', () => {
    const block = css.match(/\/\* -+ the attention figure[\s\S]*?-+ \*\/[\s\S]*?(?=\n\/\* -+|$)/)?.[0] ?? ''
    assert.ok(block, 'the attention figure CSS block must exist')
    assert.doesNotMatch(block, /data-row="views"\s*\.attention-mark/)
    assert.doesNotMatch(block, /var\(--accent\)/)
  })
})
describe('butterflyRows', () => {
  const real = (count: number, pmi = 1) => ({ count, pmi, tone: null })
  const t = (term: string, a: CompareTerm['a'], b: CompareTerm['b'], extra: Partial<CompareTerm> = {}): CompareTerm => ({ term, kind: 'word', a, b, ...extra })
  const rows = (r: ReturnType<typeof butterflyRows>) => r.groups.flatMap((g) => g.rows)
  const names = (r: ReturnType<typeof butterflyRows>) => rows(r).map((x) => x.term).sort()

  const skewed = [
    t('x', real(30, 0.1), null),
    t('y', real(20, 0.2), null),
    t('z', real(5, 3), null),
    t('p', null, real(30, 0.1)),
    t('q', null, real(20, 0.2)),
    t('r', null, real(5, 3)),
  ]

  it('selects the top limit per side by the sort measure and unions them', () => {
    const byCount = butterflyRows(skewed, 412, 168, 2, 'count')
    const byPmi = butterflyRows(skewed, 412, 168, 2, 'pmi')
    assert.deepEqual(names(byCount), ['p', 'q', 'x', 'y'])
    assert.deepEqual(names(byPmi), ['q', 'r', 'y', 'z'])
    assert.ok(rows(byCount).length <= 4 && rows(byPmi).length <= 4)
  })

  it("keeps a term picked by one side and shows the other side's bar", () => {
    const terms = [t('shared', real(30), real(2)), t('b1', null, real(9)), t('b2', null, real(8)), t('lost', null, real(1))]
    const r = butterflyRows(terms, 412, 168, 1, 'count')
    assert.deepEqual(names(r), ['b1', 'shared'])
    assert.ok(!names(r).includes('lost'))
    const shared = rows(r).find((x) => x.term === 'shared')!
    assert.equal(shared.b!.count, 2)
    assert.equal(shared.a!.count, 30)
  })

  it('drops own-name terms and counts them', () => {
    const terms = [t('lula', 'name', real(3)), t('bolsonaro', real(4), 'name'), t('reforma', real(2), null)]
    const r = butterflyRows(terms, 412, 168, 20, 'count')
    assert.deepEqual(names(r), ['reforma'])
    assert.equal(r.hiddenCount, 2)
  })

  it('orders groups a-only, both, b-only and omits an empty group', () => {
    const terms = [t('b', null, real(3)), t('both', real(3), real(3)), t('a', real(3), null)]
    const r = butterflyRows(terms, 412, 168, 20, 'count')
    assert.deepEqual(r.groups.map((g) => g.key), ['a', 'both', 'b'])
    assert.ok(rows({ ...r, groups: [r.groups[0]] }).every((x) => x.b === null))
    assert.ok(r.groups[2].rows.every((x) => x.a === null))
    assert.ok(r.groups[1].rows.every((x) => x.a && x.b))
    assert.deepEqual(butterflyRows([t('a', real(3), null)], 412, 168, 20, 'count').groups.map((g) => g.key), ['a'])
    assert.deepEqual(butterflyRows([], 412, 168, 20, 'count').groups, [])
  })

  it('orders a group by balance, combined share, then pt-BR term', () => {
    const terms = [
      t('zebra', real(41), real(17)),
      t('Álvaro', real(41), real(17)),
      t('wide', real(100), real(17)),
      t('lean', real(10), real(80)),
    ]
    const r = butterflyRows(terms, 412, 168, 20, 'count')
    const order = r.groups[0].rows.map((x) => x.term)
    assert.deepEqual(order, ['wide', 'Álvaro', 'zebra', 'lean'])
  })

  it('breaks a balance tie by combined share, then kind', () => {
    const terms = [
      t('small', real(10), real(10)),
      t('large', real(40), real(40)),
      { ...t('same', real(20), real(20)), kind: 'word' },
      { ...t('same', real(20), real(20)), kind: 'hashtag' },
    ]
    const order = butterflyRows(terms, 412, 412, 20, 'count').groups[0].rows.map((x) => `${x.kind}:${x.term}`)
    assert.deepEqual(order, ['word:large', 'hashtag:same', 'word:same', 'word:small'])
  })

  it('does not let an own-name term take a slot, and skips a term with no real side', () => {
    const terms = [t('lula', real(99), 'name'), t('keep', real(5), null), t('ghost', null, null), t('gone', 'name', 'name')]
    const r = butterflyRows(terms, 412, 168, 1, 'count')
    assert.deepEqual(names(r), ['keep'])
    assert.equal(r.hiddenCount, 2)
  })

  it('breaks a selection tie by pt-BR term, then kind', () => {
    const terms = [t('zeta', real(7), null), t('Álvaro', real(7), null), t('beta', real(7), null)]
    assert.deepEqual(names(butterflyRows(terms, 412, 168, 2, 'count')), ['beta', 'Álvaro'].sort())
  })

  it('ranks a side only among terms that side really has', () => {
    const terms = [t('onlyB', null, real(500)), t('a1', real(3), null), t('a2', real(2), null), t('a3', real(1), null)]
    assert.deepEqual(names(butterflyRows(terms, 412, 168, 2, 'count')), ['a1', 'a2', 'onlyB'])
  })

  it('guards about = 0 (finite shares, balance 0)', () => {
    const r = butterflyRows([t('a', real(5), null), t('b', null, real(5)), t('both', real(5), real(5))], 0, 0, 20, 'count')
    for (const x of rows(r)) {
      assert.ok(Number.isFinite(x.balance) && Number.isFinite(x.combined))
      assert.equal(x.a?.share ?? 0, 0)
      assert.equal(x.b?.share ?? 0, 0)
      assert.equal(x.balance, 0)
    }
    assert.deepEqual(r.scale, { domain: 0, ticks: [0] })
  })

  it('computes share as count over about, in percent', () => {
    const r = butterflyRows([t('a', real(41), real(17))], 412, 168, 20, 'count')
    assert.ok(Math.abs(rows(r)[0].a!.share - (41 / 412) * 100) < 1e-9)
    assert.ok(Math.abs(rows(r)[0].b!.share - (17 / 168) * 100) < 1e-9)
  })

  it('shares one scale with nice ticks (38, 12, 0.8, 0)', () => {
    const at = (share: number) => butterflyRows([t('w', real(share), null)], 100, 100, 20, 'count').scale
    assert.deepEqual(at(38), { domain: 40, ticks: [0, 20, 40] })
    assert.deepEqual(at(12), { domain: 15, ticks: [0, 5, 10, 15] })
    assert.deepEqual(at(0.8), { domain: 1, ticks: [0, 0.5, 1] })
    assert.deepEqual(at(0), { domain: 0, ticks: [0] })
    assert.deepEqual(at(60), { domain: 60, ticks: [0, 20, 40, 60] })
    assert.deepEqual(at(100), { domain: 100, ticks: [0, 50, 100] })
    assert.deepEqual(at(7), { domain: 10, ticks: [0, 5, 10] })
    assert.deepEqual(at(2.5), { domain: 3, ticks: [0, 1, 2, 3] })
    const r = butterflyRows([t('w', real(38), real(12))], 100, 100, 20, 'count')
    assert.ok(rows(r).every((x) => (x.a?.share ?? 0) <= r.scale.domain && (x.b?.share ?? 0) <= r.scale.domain))
  })

  it('marks bridges without changing selection or order', () => {
    const base = [t('x', real(30), real(10)), t('y', real(20), real(10)), t('z', real(5), real(30))]
    const plain = butterflyRows(base, 412, 168, 2, 'count')
    const bridged = butterflyRows(base.map((x, i) => ({ ...x, bridge: i === 2 ? 0.5 : 0.49 })), 412, 168, 2, 'count')
    assert.deepEqual(rows(bridged).map((x) => x.term), rows(plain).map((x) => x.term))
    assert.deepEqual(rows(bridged).map((x) => [x.term, x.bridge]), rows(bridged).map((x) => [x.term, x.term === 'z']))
    assert.ok(rows(plain).every((x) => x.bridge === false))
  })
})

describe('compareModeFor: compare.mode wins, legacy lenses keys open lens mode, bare keys do not (issue #326 AC9)', () => {
  const table: [string, string, 'pessoas' | 'recortes'][] = [
    ['compare.mode=recortes alone', '?compare.mode=recortes', 'recortes'],
    ['compare.mode=pessoas beats a lenses key', '?compare.mode=pessoas&lenses.a=lean:left', 'pessoas'],
    ['compare.mode=recortes beats nothing else', '?compare.mode=recortes&compare.a=lula', 'recortes'],
    ['lenses.person alone', '?lenses.person=lula', 'recortes'],
    ['lenses.a alone', '?lenses.a=lean:left', 'recortes'],
    ['lenses.b alone', '?lenses.b=source:rss', 'recortes'],
    ['lenses.days alone', '?lenses.days=7', 'recortes'],
    ['lenses.limit alone', '?lenses.limit=60', 'recortes'],
    ['an invalid compare.mode falls through to the legacy key', '?compare.mode=foo&lenses.a=all', 'recortes'],
    ['an invalid compare.mode with no legacy key', '?compare.mode=foo', 'pessoas'],
    ['empty search', '', 'pessoas'],
    ['bare person', '?person=lula', 'pessoas'],
    ['bare a', '?a=lean:left', 'pessoas'],
    ['bare b', '?b=lean:left', 'pessoas'],
    ['bare days', '?days=7', 'pessoas'],
    ['bare limit', '?limit=60', 'pessoas'],
    ['an unrelated lenses key', '?lenses.foo=1', 'pessoas'],
  ]
  for (const [name, search, expected] of table) it(name, () => assert.equal(compareModeFor(search), expected))
})

describe('thinNoteText: one sentence per side under the 50-text floor (issue #326 AC19)', () => {
  const sides = (a: number, b: number) => [{ label: 'Esquerda', about: a }, { label: 'Direita', about: b }]

  it('names both sides, A first, with their counts', () => {
    assert.equal(thinNoteText(sides(14, 25)), 'Esquerda tem só 14 textos neste recorte: leia com cuidado. Direita tem só 25 textos neste recorte: leia com cuidado.')
  })

  it('is empty when no side is thin, and exactly 50 is not thin', () => {
    assert.equal(THIN_ABOUT, 50)
    assert.equal(thinNoteText(sides(50, 50)), '')
    assert.equal(thinNoteText(sides(400, 51)), '')
  })

  it('names only the thin side', () => {
    assert.equal(thinNoteText(sides(400, 49)), 'Direita tem só 49 textos neste recorte: leia com cuidado.')
  })

  it('says texto for 1 and textos for 0', () => {
    assert.equal(thinNoteText(sides(1, 400)), 'Esquerda tem só 1 texto neste recorte: leia com cuidado.')
    assert.equal(thinNoteText(sides(0, 400)), 'Esquerda tem só 0 textos neste recorte: leia com cuidado.')
  })

  it('collapses identical sentences into one', () => {
    assert.equal(thinNoteText([{ label: 'Tudo', about: 3 }, { label: 'Tudo', about: 3 }]), 'Tudo tem só 3 textos neste recorte: leia com cuidado.')
  })
})
