import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rulerTerms } from '../src/ui/ruler-model.js'
import { stripLayout } from '../src/ui/strip-model.js'
import { hasShares, liftBalance, liftOfPerson, rareRisers, risingRulerItems, shareBalance, type CompareTerm, type RisingTerm } from '../src/ui/format.js'
import { STRIP_MAX_HEIGHT, STRIP_MIN_R, stripRadius } from '../src/ui/layout.js'

// The pure models behind the figures (ruler-model, strip-model, format's rising helpers) and the
// stylesheet rules the figures rely on. Nothing here fetches.

const side = (count: number, pmi: number) => ({ count, pmi, tone: null })

describe('stripLayout: the outlets on the axis', () => {
  it('stripLayout puts -10 at the left pad, +10 at the right pad and sizes dots by texts', () => {
    const layout = stripLayout(
      [
        { domain: 'left.example', source: 'gnews', score: -10, n: 3 },
        { domain: 'right.example', source: 'gnews', score: 10, n: 100 },
        { domain: 'mid.example', source: 'gnews', score: 0, n: 10 },
      ],
      860,
    )
    const by = (d: string) => layout.dots.find((x) => x.domain === d)!
    assert.equal(by('left.example').x, 28)
    assert.equal(by('right.example').x, 860 - 28)
    assert.equal(by('mid.example').x, 430)
    assert.ok(by('right.example').r > by('mid.example').r && by('mid.example').r > by('left.example').r)
    assert.equal(stripRadius(3), 4 + 2.8 * Math.sqrt(3))
    assert.equal(stripRadius(10_000), 30, 'capped')
    assert.equal(stripRadius(10_000, 328), 30 * 0.55, 'a phone-wide strip shrinks the dots, floor 55%')
    assert.equal(stripRadius(3, 2000), 4 + 2.8 * Math.sqrt(3), 'a wide strip never grows them')
    assert.ok(stripLayout([{ domain: 'a.example', source: 'gnews', score: 0, n: 10 }], 328).dots[0].r < by('mid.example').r, 'same texts, narrower strip, smaller dot')
    assert.equal(layout.height, layout.half * 2)
  })

  it('caps the strip at STRIP_MAX_HEIGHT by shrinking every dot together, never by dropping one', () => {
    // 150 outlets inside a quarter of the axis, like Lula's, each with plenty of texts.
    const crowded = Array.from({ length: 150 }, (_, i) => ({ domain: `o${i}.example`, source: 'gnews', score: -5 + (i % 50) * 0.1, n: 5 + (i % 40) * 3 }))
    const full = stripLayout(crowded.slice(0, 5), 957)
    assert.equal(full.scale, 1, 'a handful of outlets never shrinks')
    const capped = stripLayout(crowded, 957)
    assert.equal(capped.dots.length, 150)
    assert.ok(capped.height <= STRIP_MAX_HEIGHT, `height ${capped.height}`)
    assert.ok(capped.scale < 1 && capped.scale > 0)
    const ratio = capped.dots.find((d) => d.domain === 'o0.example')!.r / full.dots.find((d) => d.domain === 'o0.example')!.r
    for (const d of capped.dots) {
      const base = Math.min(30, 4 + 2.8 * Math.sqrt(d.n))
      assert.ok(Math.abs(d.r / base - ratio) < 1e-9, 'every dot shrinks by the same factor, so sizes stay comparable within the strip')
      assert.ok(d.r >= STRIP_MIN_R - 1e-9, 'never under the minimum radius')
    }
    for (let i = 0; i < capped.dots.length; i++)
      for (let j = i + 1; j < capped.dots.length; j++) {
        const a = capped.dots[i], b = capped.dots[j]
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 1.5 - 1e-6, 'still no overlap')
      }
    // Past the minimum radius the height is allowed to grow again rather than dots vanish.
    // 150 outlets stacked on a tenth of the axis already pins every dot at STRIP_MIN_R and
    // pushes the height to 1144px, well past the cap. swarm is cubic in the number of dots
    // sharing an x, so a larger crowd only buys a slower test: 1200 of them cost 169s.
    const absurd = Array.from({ length: 150 }, (_, i) => ({ domain: `z${i}.example`, source: 'gnews', score: -2 + (i % 10) * 0.01, n: 3 }))
    const grown = stripLayout(absurd, 957)
    assert.equal(grown.dots.length, 150)
    assert.ok(grown.height > STRIP_MAX_HEIGHT)
    assert.ok(grown.dots.every((d) => Math.abs(d.r - STRIP_MIN_R) < 1e-9))
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

  it('.map-svg.is-themed .atlas-word and .columns.is-themed .column-card both fall back to --muted, so an uncoloured node never vanishes (code review fix #4)', () => {
    assert.match(
      css,
      /\.map-svg\.is-themed \.atlas-word[^{]*\{[^}]*--wc:\s*var\(--theme,\s*var\(--muted\)\)/,
      'the atlas map must keep the --muted fallback on --wc in tema mode',
    )
    assert.match(
      css,
      /\.columns\.is-themed \.column-card\s*\{[^}]*--wc:\s*var\(--theme,\s*var\(--muted\)\)/,
      'the columns list must keep the --muted fallback on --wc in tema mode',
    )
  })
})

describe('rulerTerms: balance is -1/+1 for a one-sided term and 0 for an identical-both-sides term (issue #91 AC5)', () => {
  it('an a-only term is -1, a b-only term is +1, an identical-both-sides term is 0, under count', () => {
    const terms = [
      { term: 'onlyA', kind: 'word', a: { count: 5, pmi: 1, tone: null }, b: null },
      { term: 'onlyB', kind: 'word', a: null, b: { count: 5, pmi: 1, tone: null } },
      { term: 'same', kind: 'word', a: { count: 4, pmi: 2, tone: null }, b: { count: 4, pmi: 2, tone: null } },
    ]
    const { items } = rulerTerms(terms, 'count')
    assert.equal(items.find((t) => t.term === 'onlyA')!.balance, -1)
    assert.equal(items.find((t) => t.term === 'onlyB')!.balance, 1)
    assert.equal(items.find((t) => t.term === 'same')!.balance, 0)
  })

  it('the identical-both-sides term stays 0 under pmi too, regardless of measure', () => {
    const terms = [{ term: 'same', kind: 'word', a: { count: 4, pmi: 2, tone: null }, b: { count: 4, pmi: 2, tone: null } }]
    assert.equal(rulerTerms(terms, 'pmi').items[0].balance, 0)
  })
})

describe('rulerTerms: measure changes position but never the combined document count (issue #91 AC6)', () => {
  it('switching measure moves at least one term\'s balance while combined stays identical for every term', () => {
    const terms = [
      { term: 'mixed', kind: 'word', a: { count: 10, pmi: 0.1, tone: null }, b: { count: 2, pmi: 5, tone: null } },
      { term: 'aonly', kind: 'word', a: { count: 1, pmi: 0.1, tone: null }, b: null },
    ]
    const byCount = rulerTerms(terms, 'count')
    const byPmi = rulerTerms(terms, 'pmi')
    assert.deepEqual(
      byCount.items.map((t) => t.combined),
      byPmi.items.map((t) => t.combined),
      'combined must never depend on measure',
    )
    const balanceCount = byCount.items.find((t) => t.term === 'mixed')!.balance
    const balancePmi = byPmi.items.find((t) => t.term === 'mixed')!.balance
    assert.notEqual(balanceCount, balancePmi, 'balance must move with measure for a term with different count/pmi shapes on each side')
  })
})

describe('regression: an opposite-signed-but-real term on both sides never pins to a literal end, and a null side never wins on the other\'s negative score', () => {
  it('alcolumbre (real docs and a negative PMI on the b side) settles short of -1', () => {
    const terms = [{ term: 'alcolumbre', kind: 'word', a: { count: 233, pmi: 0.61, tone: null }, b: { count: 8, pmi: -2.93, tone: null } }]
    const balance = rulerTerms(terms, 'pmi').items[0].balance
    assert.ok(Math.abs(balance) < 1, `balance must not pin to a literal end when both sides have documents, got ${balance}`)
  })

  it('an a-only term (b truly absent) with a negative PMI is still -1, not +1', () => {
    const terms = [{ term: 'onlyANegative', kind: 'word', a: { count: 5, pmi: -1, tone: null }, b: null }]
    assert.equal(rulerTerms(terms, 'pmi').items[0].balance, -1)
  })
})

describe('rulerTerms copies bridge, and the ruler-bridge mark (issue #219 AC7)', () => {
  it('rulerTerms attaches bridge onto its emitted item only when the source CompareTerm carries it', () => {
    const terms = [
      { term: 'ponte', kind: 'word', a: side(10, 1), b: side(10, 1), bridge: 0.9 },
      { term: 'sembridge', kind: 'word', a: side(10, 1), b: side(10, 1) },
    ] as (CompareTerm & { bridge?: number })[]
    const { items } = rulerTerms(terms as CompareTerm[], 'count') as { items: (typeof terms[number] & { balance: number; combined: number })[] }
    assert.equal(items.find((i) => i.term === 'ponte')?.bridge, 0.9)
    assert.equal(items.find((i) => i.term === 'sembridge')?.bridge, undefined)
  })
})

describe('rulerTerms: a term where either side is the string "name" is absent from the rendered set (issue #91 AC7)', () => {
  it('rulerTerms drops it and counts it as hidden, for either side', () => {
    const terms: CompareTerm[] = [
      { term: 'lula', kind: 'word', a: 'name', b: { count: 3, pmi: 1, tone: null } },
      { term: 'bolsonaro', kind: 'word', a: { count: 4, pmi: 1, tone: null }, b: 'name' },
      { term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null },
    ]
    const { items, hiddenCount } = rulerTerms(terms, 'count')
    assert.deepEqual(items.map((t) => t.term), ['reforma'])
    assert.equal(hiddenCount, 2, 'a name on the b side hides the term just as one on the a side does')
  })
})

describe('rulerTerms: the amended balance formula clamps each side at zero before differencing', () => {
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

describe('risingRulerItems / shareBalance position by the word\'s share of everything written about the person', () => {
  // 40 word rows this week, 16 before: a word with 5 rows now and 1 (+1 smoothing → 2) before
  // holds 1/8 of the words in both windows.
  const about = { recent: 10, baseline: 5, words_recent: 40, words_baseline: 16 }
  const byShare = (a: typeof about) => (t: RisingTerm) => shareBalance(t, a)

  it('a term whose share is unchanged sits at the centre (balance === 0)', () => {
    const items = risingRulerItems([risingTerm({ term: 'igual', count_recent_raw: 5, count_baseline_raw: 1 })], byShare(about))
    assert.equal(items[0].balance, 0)
  })

  it('a share 8x bigger than before clamps to the rightmost position (balance === 1)', () => {
    const exactlyEight = risingRulerItems([risingTerm({ term: 'oito', count_recent_raw: 40, count_baseline_raw: 1 })], byShare(about))
    assert.equal(exactlyEight[0].balance, 1, 'log2(8)/3 === 1 exactly')
    const wellOver = risingRulerItems([risingTerm({ term: 'muito-mais', count_recent_raw: 40, count_baseline_raw: 0 })], byShare({ ...about, words_baseline: 5000 }))
    assert.equal(wellOver[0].balance, 1, 'anything past the clamp still reads as 1, never more')
  })

  it('a share 8x smaller than before clamps to the leftmost position (balance === -1)', () => {
    const items = risingRulerItems([risingTerm({ term: 'oitavo', count_recent_raw: 1, count_baseline_raw: 15 })], byShare({ ...about, words_recent: 64 }))
    assert.equal(items[0].balance, -1, '1/64 now against 16/16 before, clamped at -1')
  })

  it('a corpus whose docs grew longer does not push a steady word right: shares, not doc counts', () => {
    // Same 10 docs both weeks, but the recent ones carry 6x the words. A word in half the docs
    // either week keeps its share only if the totals scale with it.
    const grown = { recent: 10, baseline: 10, words_recent: 600, words_baseline: 100 }
    const steady = risingRulerItems([risingTerm({ term: 'sempre', count_recent_raw: 30, count_baseline_raw: 4 })], byShare(grown))
    assert.equal(steady[0].balance, 0)
  })

  it('stays finite with no baseline words at all: everything present is new, so it reads +1', () => {
    const items = risingRulerItems([risingTerm({ term: 'novo', count_recent_raw: 3, count_baseline_raw: 0 })], byShare({ recent: 5, baseline: 0, words_recent: 9, words_baseline: 0 }))
    assert.equal(items[0].balance, 1)
    assert.equal(shareBalance({ count_recent_raw: 0, count_baseline_raw: 0 }, { recent: 0, baseline: 0, words_recent: 0, words_baseline: 0 }), 0)
  })

  it('no words in the recent window reads -1, whatever the counts', () => {
    assert.equal(shareBalance({ count_recent_raw: 4, count_baseline_raw: 2 }, { recent: 0, baseline: 5, words_recent: 0, words_baseline: 9 }), -1)
  })

  it('combined is the raw recent+baseline doc count, independent of balance', () => {
    const items = risingRulerItems([risingTerm({ term: 'soma', count_recent_raw: 12, count_baseline_raw: 3 })], byShare(about))
    assert.equal(items[0].combined, 15)
  })

  // The pre-#164 rule, kept for a payload that predates `present`/`about.words_*`.
  it('liftBalance / liftOfPerson: the fallback positions by the person\'s own lift and stays finite at baseline 0', () => {
    const lp = liftOfPerson({ recent: 10, baseline: 5 }, 7, 30)
    assert.equal(liftBalance({ lift: lp }, lp), 0)
    assert.equal(liftBalance({ lift: lp * 8 }, lp), 1)
    assert.equal(liftBalance({ lift: lp / 8 }, lp), -1)
    const zero = liftOfPerson({ recent: 5, baseline: 0 }, 7, 30)
    assert.ok(Number.isFinite(zero) && zero > 0)
    assert.equal(liftBalance({ lift: 3 }, 0), 1, 'a person with no pace at all: any lift reads +1')
    assert.equal(liftBalance({ lift: 0 }, 0), 0, 'and no lift against no pace reads the middle')
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

describe('one rx source for the word marks', () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const css = readFileSync(join(root, 'public', 'atlas.css'), 'utf8')

  // The block-body finder for a class selector, tolerant of a rule declared with several
  // comma-separated selectors (".ruler-glow, .week-glow { rx: 8px }" is how the spec's own
  // example groups the shared value).
  const ruleFor = (selector: string) => {
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = m[1].split(',').map((s) => s.trim())
      if (selectors.includes(selector)) return m[2]
    }
    return ''
  }
  const rxOf = (selector: string) => {
    const body = ruleFor(selector)
    const found = body.match(/rx\s*:\s*([\d.]+)px/)
    return found ? Number(found[1]) : undefined
  }

  it('the map-svg.is-masked mask-and-underline rule still targets the atlas word class', () => {
    assert.match(css, /\.map-svg\.is-masked \.atlas-word/)
  })

  it('atlas.css sets rx on the six rules, at the same values the markup used to carry', () => {
    assert.equal(rxOf('.atlas-glow'), 9)
    assert.equal(rxOf('.atlas-hit'), 6)
    assert.equal(rxOf('.ruler-glow'), 8)
    assert.equal(rxOf('.ruler-hit'), 5)
    assert.equal(rxOf('.week-glow'), 8)
    assert.equal(rxOf('.week-hit'), 5)
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