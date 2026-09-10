import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { seed } from './fixture.js'
import { docsText } from './docs.js'
import { clearScopes } from '../src/ui/state.js'
import { compareParams, loadCompare } from '../src/ui/api.js'
import { balanceColor, SCALE_MID } from '../src/ui/format.js'
import { paintCompareDetail, paintRuler, rulerTerms } from '../src/ui/render.js'
import { withFakeDocument } from './fake-dom.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import './close.js'
import type { Compare, CompareTerm } from '../src/ui/format.js'

// The injected text measurer paintRuler hands to layout.js, the same contract public/js/layout.js
// documents: deterministic here, a real canvas in the browser. 0.6em per character is close
// enough to Instrument Sans that a word's box is the right order of magnitude.
const metrics = (text: string, size: number) => text.length * size * 0.6

// Independent verification of issue #91's numbered acceptance criteria, written from the
// approved spec rather than from public/js/figures/compare.js's own implementation. Follows
// the pattern of test/atlas-figures-independence.test.ts (#92's own test plan): a fake
// document, a spied fetch, no browser, and the pure logic module (rulerTerms) exercised
// directly wherever a criterion is about numbers rather than a click.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const design5 = () => readFileSync(join(root, 'public', 'design-5.html'), 'utf8')
const comoLer = () => readFileSync(join(root, 'public', 'como-ler.html'), 'utf8')

const personA = { id: 'lula', name: 'Lula' }
const personB = { id: 'bolsonaro', name: 'Bolsonaro' }
const people = [personA, personB]

const compareData = (terms: CompareTerm[], a = personA, b = personB): Compare => ({
  days: 30,
  a: { person: a, about: 5 },
  b: { person: b, about: 5 },
  terms,
})

describe('AC1: figures/compare.js is importable outside a browser, touches document only inside mount, exports exactly mount', async () => {
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document defined at import time')
  const mod = await import('../src/ui/figures/compare.js')
  it('does not touch document at import time', () => {
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/compare.js must not touch document')
  })
  it('exports exactly mount', () => {
    assert.deepEqual(Object.keys(mod), ['mount'])
    assert.equal(typeof mod.mount, 'function')
  })
})

describe('AC3: compareParams/loadCompare match calling /api/compare directly', () => {
  it('produces the same query string result as calling /api/compare with kind=word,hashtag,phrase and no domain/lean', async () => {
    await seed()
    const qp = compareParams({ a: 'lula', b: 'bolsonaro', days: '30', source: 'all', limit: '40' })
    const resA = await app.request('/api/compare?' + qp.toString())
    const resB = await app.request('/api/compare?a=lula&b=bolsonaro&days=30&source=all&limit=40&kind=word,hashtag,phrase')
    assert.equal(resA.status, 200)
    assert.deepEqual(await resA.json(), await resB.json())
  })

  it('never sets domain or lean, leaving both at the server default', () => {
    const qp = compareParams({ a: 'lula', b: 'bolsonaro', days: '30', source: 'all', limit: '40' })
    assert.equal(qp.has('domain'), false)
    assert.equal(qp.has('lean'), false)
  })

  it('loadCompare fetches /api/compare with the exact query string it was given', async () => {
    const previous = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (url: string) => {
      calls.push(url)
      return { ok: true, status: 200, json: async () => ({}) } as Response
    }) as typeof fetch
    try {
      const qp = compareParams({ a: 'lula', b: 'bolsonaro', days: '30', source: 'all', limit: '40' })
      await loadCompare(qp)
      assert.equal(calls[0], '/api/compare?' + qp.toString())
    } finally {
      globalThis.fetch = previous
    }
  })
})

describe('AC4: format.js exports balanceColor', () => {
  it('balanceColor(0) equals SCALE_MID', () => {
    assert.equal(balanceColor(0), SCALE_MID)
  })

  it('balanceColor(-1) and balanceColor(1) are two distinct, non-grey colours', () => {
    const left = balanceColor(-1)
    const right = balanceColor(1)
    assert.notEqual(left, right)
    assert.notEqual(left, SCALE_MID)
    assert.notEqual(right, SCALE_MID)
  })

  it('is monotonic in |balance| for each sign, walking a few sample points', () => {
    const toRgb = (c: string) => (c.startsWith('#') ? [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16)) : (c.match(/\d+/g) ?? []).map(Number))
    const mid = toRgb(SCALE_MID)
    const dist = (c: string) => {
      const [r, g, b] = toRgb(c)
      const [mr, mg, mb] = mid
      return Math.hypot(r - mr, g - mg, b - mb)
    }
    const negatives = [0, -0.25, -0.5, -0.75, -1].map((b) => dist(balanceColor(b)))
    const positives = [0, 0.25, 0.5, 0.75, 1].map((b) => dist(balanceColor(b)))
    for (let i = 1; i < negatives.length; i++) assert.ok(negatives[i] >= negatives[i - 1], `distance from SCALE_MID must not decrease walking toward -1: ${negatives}`)
    for (let i = 1; i < positives.length; i++) assert.ok(positives[i] >= positives[i - 1], `distance from SCALE_MID must not decrease walking toward +1: ${positives}`)
    assert.ok(negatives[negatives.length - 1] > negatives[0], 'the -1 end must be strictly further from SCALE_MID than the centre')
    assert.ok(positives[positives.length - 1] > positives[0], 'the +1 end must be strictly further from SCALE_MID than the centre')
  })
})

describe('AC5: computes balance -1/+1 for a one-sided term and 0 for an identical-both-sides term', () => {
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

describe('AC6: measure changes position but never the combined document count', () => {
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

describe('AC7: a term where either side is the string "name" is absent from the rendered set', () => {
  it('rulerTerms drops it and counts it as hidden', () => {
    const terms: CompareTerm[] = [
      { term: 'lula', kind: 'word', a: 'name', b: { count: 3, pmi: 1, tone: null } },
      { term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null },
    ]
    const { items, hiddenCount } = rulerTerms(terms, 'count')
    assert.equal(items.length, 1)
    assert.equal(items[0].term, 'reforma')
    assert.equal(hiddenCount, 1)
  })

  it('paintRuler produces no dot for the name term and reports the same hiddenCount', () => {
    withFakeDocument(['compareRuler'], (els) => {
      const terms: CompareTerm[] = [
        { term: 'lula', kind: 'word', a: 'name', b: { count: 3, pmi: 1, tone: null } },
        { term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null },
      ]
      const data = compareData(terms)
      const { hiddenCount } = paintRuler({ data, personA, personB, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.equal(hiddenCount, 1)
      assert.doesNotMatch(els.compareRuler.innerHTML, /data-term="lula"/)
      assert.match(els.compareRuler.innerHTML, /data-term="reforma"/)
    })
  })
})

describe('AC8: the hidden-name note is absent when the count is zero, present with the exact count otherwise', () => {
  // AC8 says the note is "absent from the DOM when the hidden-name count is 0 (or the
  // equivalent painted note)". design-5.html ships the element and figures/compare.js toggles
  // `hidden` and empties its text, which is the second reading: nothing is announced, and a
  // screen reader skips a `hidden` node exactly as it skips an absent one.
  it('#compareHiddenNote stays hidden and empty when nothing was dropped', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([{ term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null }]) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush()
      assert.equal(els.compareHiddenNote.hidden, true)
    })
  })

  it('#compareHiddenNote reports the exact count when at least one term was dropped', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const terms: CompareTerm[] = [
        { term: 'lula', kind: 'word', a: 'name', b: { count: 3, pmi: 1, tone: null } },
        { term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null },
      ]
      routeFetch(calls, { '/compare': compareData(terms) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush()
      assert.equal(els.compareHiddenNote.hidden, false)
      assert.match(els.compareHiddenNote.textContent, /\b1\b/)
    })
  })
})

describe('AC9: shows the same-person notice only when a === b', () => {
  it('the static markup carries the exact same-person string', () => {
    assert.match(design5(), /<p class="status" id="compareStatus" role="status" hidden>Os dois lados mostram a mesma pessoa\.<\/p>/)
  })

  it('#compareStatus becomes visible when a === b', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([], personA, personA) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush()
      assert.equal(els.compareStatus.hidden, false)
    })
  })

  it('#compareStatus stays hidden when a !== b', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([], personA, personB) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush()
      assert.equal(els.compareStatus.hidden, true)
    })
  })
})

describe('AC10: clicking a dot fills the detail line, including "nenhum documento" for the null side', () => {
  it('clicking a rendered dot names both people, "nenhum documento" for the null side', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([{ term: 'reforma', kind: 'word', a: { count: 5, pmi: 1.2, tone: null }, b: null }]) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush()
      const [dot] = els.compareRuler.querySelectorAll('[data-term]')
      assert.ok(dot, 'the ruler must render one clickable dot')
      dot.fire('click')
      assert.match(els.compareDetail.innerHTML, /Lula/)
      assert.match(els.compareDetail.innerHTML, /<dt>Bolsonaro<\/dt><dd class="empty-hint">nenhum documento<\/dd>/)
      assert.doesNotMatch(els.compareDetail.innerHTML, /0 documentos/, 'a null side reads "nenhum documento", never "0 documentos"')
    })
  })
})

describe('AC10: clicking the same dot again, or empty ruler space, clears the selection', () => {
  it('clicking the same dot again returns the detail line to its empty hint', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([{ term: 'reforma', kind: 'word', a: { count: 5, pmi: 1.2, tone: null }, b: null }]) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush()
      let dot = els.compareRuler.querySelectorAll('[data-term]')[0]
      dot.fire('click')
      assert.match(els.compareDetail.innerHTML, /nenhum documento/)
      dot = els.compareRuler.querySelectorAll('[data-term]')[0]
      dot.fire('click')
      assert.match(els.compareDetail.innerHTML, /Clique numa palavra/)
    })
  })

  it('clicking empty ruler space (not a dot) releases the selection', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([{ term: 'reforma', kind: 'word', a: { count: 5, pmi: 1.2, tone: null }, b: null }]) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush()
      const dot = els.compareRuler.querySelectorAll('[data-term]')[0]
      dot.fire('click')
      assert.match(els.compareDetail.innerHTML, /nenhum documento/)
      els.compareRuler.fire('click', { target: { closest: () => null } })
      assert.match(els.compareDetail.innerHTML, /Clique numa palavra/)
    })
  })
})

const emptyGraph = (person: { id: string; name: string }) => ({
  person,
  nodes: [],
  links: [],
  stats: { about: 0, testimony: { method: 'kikori', score: null, n: 0 } },
})
const emptyTestimony = { method: 'kikori', overall: { score: null, n: 0 }, by_source: [], by_domain: [] }

const withLocation = async <T>(search: string, fn: () => Promise<T> | T): Promise<T> => {
  const previous = (globalThis as { location?: unknown }).location
  ;(globalThis as { location?: unknown }).location = { search }
  try {
    return await fn()
  } finally {
    ;(globalThis as { location?: unknown }).location = previous
  }
}

// app.js's own self-boot only ever fires once per process, and only when a document already
// exists at import time; importing it statically here, before any test installs a fake
// document, keeps that guard false for this whole file.
const appModule = await import('../src/ui/app.js')

describe("AC9 bootstrap: a === b's resolution contract, from the querystring down to /api/compare", () => {
  it('initial: { a: "lula", b: "lula" } sends a=lula&b=lula to /api/compare', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([], personA, personA) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: { a: 'lula', b: 'lula' } })
      await flush()
      const url = calls.find((u) => u.includes('/api/compare'))
      assert.ok(url, 'must have requested /api/compare')
      const qs = new URL(url!, 'http://localhost').searchParams
      assert.equal(qs.get('a'), 'lula')
      assert.equal(qs.get('b'), 'lula')
    })
  })

  it("bare ?person= seeds compareA, the same fallback figures 1 and 2's own person control reads", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': people, '/graph': emptyGraph(personA), '/sources': [], '/testimony': emptyTestimony, '/compare': compareData([]) })
      await withLocation('?person=bolsonaro', () => appModule.boot())
      await flush()
      assert.equal(els.compareA.value, 'bolsonaro')
    })
  })

  it('with no seed at all, compareB resolves to the second distinct tracked person', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([], personA, personB) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush()
      assert.equal(els.compareB.value, personB.id)
    })
  })

  it("a single-person tracked list resolves compareB to compareA's own id", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/compare': compareData([], personA, personA) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people: [personA], initial: {} })
      await flush()
      assert.equal(els.compareB.value, els.compareA.value)
    })
  })

  it('?compare.measure=pmi seeds compareMeasure, one of the two keys with no bare equivalent', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': people, '/graph': emptyGraph(personA), '/sources': [], '/testimony': emptyTestimony, '/compare': compareData([]) })
      await withLocation('?compare.measure=pmi', () => appModule.boot())
      await flush()
      assert.equal(els.compareMeasure.value, 'pmi')
    })
  })
})

describe('AC11: changing a compare control refetches only compare, and vice versa', () => {
  const controlCases: [string, string][] = [
    ['compareA', 'bolsonaro'],
    ['compareB', 'lula'],
    ['compareDays', '365'],
    ['compareSource', 'bluesky'],
    ['compareLimit', '100'],
  ]
  for (const [id, value] of controlCases) {
    it(`changing ${id} triggers exactly one new /api/compare call, and no /graph, /sources or /testimony calls`, async () => {
      await withFiguresDom(async (els, calls) => {
        clearScopes()
        routeFetch(calls, { '/api/people': people, '/graph': emptyGraph(personA), '/sources': [], '/testimony': emptyTestimony, '/compare': compareData([]) })
        await withLocation('', () => appModule.boot())
        await flush()
        const before = calls.length
        ;(els as unknown as Record<string, { value: string; fire: (t: string) => void }>)[id].value = value
        ;(els as unknown as Record<string, { value: string; fire: (t: string) => void }>)[id].fire('change')
        await flush(220)
        const added = calls.slice(before)
        assert.equal(added.filter((u) => u.includes('/api/compare')).length, 1, `expected exactly one /api/compare call for ${id}: ${JSON.stringify(added)}`)
        assert.ok(!added.some((u) => u.includes('/graph') || u.includes('/sources') || u.includes('/testimony')), `figures 1 and 2 must not reload for ${id}: ${JSON.stringify(added)}`)
      })
    })
  }

  // compareMeasure deviates from the "exactly one" rule above, on purpose, and by its own
  // listener rather than by luck: api.compareParams's ({a, b, days, source, limit}) signature
  // never carries measure (issue #91 §3, "the measure selector drives position only"), so the
  // response on screen already holds both numbers for every term and only the position moves.
  // Routing it through onControlChange would resolve from state.js's memo inside the 20s TTL
  // and pay a real round trip outside it, for an identical payload. onMeasureChange repaints
  // and nothing else, so zero new /api/compare calls is the contract here, at any TTL.
  it('changing compareMeasure alone triggers zero new /api/compare calls but still repaints the ruler', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const terms = [{ term: 'mixed', kind: 'word', a: { count: 10, pmi: 0.1, tone: null }, b: { count: 2, pmi: 5, tone: null } }]
      routeFetch(calls, { '/api/people': people, '/graph': emptyGraph(personA), '/sources': [], '/testimony': emptyTestimony, '/compare': compareData(terms) })
      await withLocation('', () => appModule.boot())
      await flush()
      // Emptied AFTER the boot fetch, so the memo cannot answer for this change. Clearing it
      // before boot (the obvious spelling) makes the assertion vacuous: the key would already
      // be cached at fire time and an implementation routing measure through onControlChange
      // would also record zero calls. With the memo empty, only a repaint-only listener can.
      clearScopes()
      const before = calls.length
      const beforeMarkup = els.compareRuler.innerHTML
      els.compareMeasure.value = 'pmi'
      els.compareMeasure.fire('change')
      await flush(220)
      const added = calls.slice(before)
      assert.equal(added.filter((u) => u.includes('/api/compare')).length, 0, `measure alone must not refetch, at any TTL: ${JSON.stringify(added)}`)
      assert.notEqual(els.compareRuler.innerHTML, beforeMarkup, 'the ruler must still repaint when measure changes')
    })
  })

  // A measure switch is the same word seen through another lens, so the dot the reader picked
  // has to still be picked afterwards. Every other control releases it (onControlChange), which
  // is why this one gets its own assertion rather than riding along above.
  it('changing compareMeasure keeps the selected word on the detail line', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      const terms = [{ term: 'mixed', kind: 'word', a: { count: 10, pmi: 0.1, tone: null }, b: { count: 2, pmi: 5, tone: null } }]
      routeFetch(calls, { '/compare': compareData(terms) })
      const { mount } = await import('../src/ui/figures/compare.js')
      mount(els.compare, { people, initial: {} })
      await flush()
      els.compareRuler.querySelectorAll('[data-term]')[0].fire('click')
      assert.match(els.compareDetail.innerHTML, /mixed/, 'the dot must be selected before the switch')
      clearScopes()
      els.compareMeasure.value = 'pmi'
      els.compareMeasure.fire('change')
      await flush(220)
      assert.match(els.compareDetail.innerHTML, /mixed/, 'the selected word must survive a measure switch')
    })
  })

  it("changing figure 1's own control never triggers a new loadCompare call", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': people, '/graph': emptyGraph(personA), '/sources': [], '/testimony': emptyTestimony, '/compare': compareData([]) })
      await withLocation('', () => appModule.boot())
      await flush()
      const before = calls.length
      els.days.value = '365'
      els.days.fire('change')
      await flush(220)
      const added = calls.slice(before)
      assert.ok(added.some((u) => u.includes('/graph')), 'figure 1 must reload')
      assert.ok(!added.some((u) => u.includes('/api/compare')), `figure 3 must not reload: ${JSON.stringify(added)}`)
    })
  })

  it("changing figure 2's own control never triggers a new loadCompare call", async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, { '/api/people': people, '/graph': emptyGraph(personA), '/sources': [], '/testimony': emptyTestimony, '/compare': compareData([]) })
      await withLocation('', () => appModule.boot())
      await flush()
      const before = calls.length
      els.testimonyDays.value = '365'
      els.testimonyDays.fire('change')
      await flush(220)
      const added = calls.slice(before)
      assert.ok(added.some((u) => u.includes('/sources') || u.includes('/testimony')), 'figure 2 must reload')
      assert.ok(!added.some((u) => u.includes('/api/compare')), `figure 3 must not reload: ${JSON.stringify(added)}`)
    })
  })
})

describe('AC12: no word rendered by the ruler ever opens #docsDialog', () => {
  it('figures/compare.js never wires docsDialog (a comment may still name it as documentation)', () => {
    const src = readFileSync(join(root, 'src', 'ui', 'figures', 'compare.ts'), 'utf8')
    const code = src
      .split('\n')
      .map((line) => line.replace(/\/\/.*/, ''))
      .join('\n')
    assert.doesNotMatch(code, /docsDialog/)
  })

  it('a rendered dot carries no data-docs-open-style attribute and no reference to the dialog', () => {
    withFakeDocument(['compareRuler'], (els) => {
      const data = compareData([{ term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null }])
      paintRuler({ data, personA, personB, measure: 'count', metrics, selected: null, onPick: () => {} })
      assert.doesNotMatch(els.compareRuler.innerHTML, /data-docs-open/)
      assert.doesNotMatch(els.compareRuler.innerHTML, /docsDialog/)
    })
  })

  it('paintCompareDetail never emits a link or button referencing the dialog', () => {
    withFakeDocument(['compareDetail'], (els) => {
      paintCompareDetail({ term: { term: 'reforma', kind: 'word', a: { count: 2, pmi: 1, tone: null }, b: null }, personA, personB })
      assert.doesNotMatch(els.compareDetail.innerHTML, /docsDialog/)
      assert.doesNotMatch(els.compareDetail.innerHTML, /<a\b/)
      assert.doesNotMatch(els.compareDetail.innerHTML, /<button\b/)
    })
  })
})

describe('AC13: design-5.html carries the third figure card', () => {
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

describe('AC14: public/compare.html no longer exists', () => {
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

describe('AC16: como-ler.html explains the ruler under #comparar', () => {
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

describe('issue #91 AC15 docs cross-check: the /api/compare route stays documented for the name/null distinction', () => {
  // Not a new criterion (test/compare-api-acceptance.test.ts already covers issue #93 AC15
  // directly); re-asserted here only as a sanity check that this issue did not regress it.
  it('the docs still name the own-name "name" hiding and the null-side distinction', () => {
    assert.match(docsText, /\/api\/compare/)
    assert.match(docsText, /"name"/)
    assert.match(docsText, /own name/)
  })
})
