import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attentionParams } from '../src/ui/api.js'
import { clearScopes } from '../src/ui/state.js'
import { flush, routeFetch, withFiguresDom } from './fake-mount-dom.js'
import './close.js'

// src/ui/figures/attention.ts, figure 7 (issue #216): its own mount(), wired twice through
// figure.ts's runFigure ('attention' for GET /attention, 'mentions' for the term-less
// GET /timeline), the docs-card click wiring and the empty-/attention note. paintAttention/
// paintAttentionLoading/paintAttentionError are exercised directly, as pure painters, in
// test/render.test.ts; peakDay and the independent-scale sizing in test/layout.test.ts and
// test/render.test.ts.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const atlasPage = () => readFileSync(join(root, 'public', 'atlas.html'), 'utf8')

const personA = { id: 'lula', name: 'Lula' }
const personB = { id: 'bolsonaro', name: 'Bolsonaro' }
const people = [personA, personB]

const attentionData = (series: { day: string; views: number }[]) => ({ days: 30, series })

// bucket_start values already sit on a UTC midnight in this fixture, so the figure's own
// bucket-to-UTC-date derivation (§3 rule 1) is unambiguous for the assertions below.
const timelineBucket = (isoDate: string, count: number) => ({ bucket_start: `${isoDate}T00:00:00.000Z`, count })
const timelineData = (buckets: { bucket_start: string; count: number }[]) => buckets

describe('figures/attention.js is importable outside a browser, touches document only inside mount, exports exactly mount', async () => {
  assert.equal((globalThis as { document?: unknown }).document, undefined, 'this suite must run with no document defined at import time')
  const mod = await import('../src/ui/figures/attention.js')
  it('does not touch document at import time (AC7)', () => {
    assert.equal((globalThis as { document?: unknown }).document, undefined, 'importing figures/attention.js must not touch document')
  })
  it('exports exactly mount (AC7)', () => {
    assert.deepEqual(Object.keys(mod), ['mount'])
    assert.equal(typeof mod.mount, 'function')
  })
})

describe('attentionParams stays fixed at days=30 (AC5, api.test.ts carries the direct unit test)', () => {
  it('the figure never overrides the fixed window', () => {
    assert.equal(attentionParams({}).get('days'), '30')
  })
})

describe('(mount): fetches /attention and a term-less /timeline with the figure own recorte', () => {
  it('requests /timeline with no term (or term=""), kind=word,hashtag,phrase, days=30, bucket=day and the selected source (AC6)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/attention': attentionData([{ day: '2026-08-15', views: 100 }]),
        '/timeline': timelineData([timelineBucket('2026-08-15', 4)]),
      })
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'bolsonaro', source: 'gdelt' } })
      await flush()
      const url = calls.find((u) => u.includes('/timeline'))
      assert.ok(url, 'must have requested /timeline')
      assert.match(url!, /\/api\/people\/bolsonaro\/timeline\?/)
      const qs = new URL(url!, 'http://localhost').searchParams
      assert.ok(!qs.has('term') || qs.get('term') === '', 'the mentions series is never filtered to one term')
      assert.equal(qs.get('kind'), 'word,hashtag,phrase')
      assert.equal(qs.get('days'), '30')
      assert.equal(qs.get('bucket'), 'day')
      assert.equal(qs.get('source'), 'gdelt')
    })
  })

  it('requests /attention with days=30 for the selected person, the fixed window companion of AC5/AC6', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/attention': attentionData([{ day: '2026-08-15', views: 100 }]),
        '/timeline': timelineData([timelineBucket('2026-08-15', 4)]),
      })
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'lula' } })
      await flush()
      const url = calls.find((u) => u.includes('/attention'))
      assert.ok(url, 'must have requested /attention')
      assert.match(url!, /\/api\/people\/lula\/attention\?/)
      assert.equal(new URL(url!, 'http://localhost').searchParams.get('days'), '30')
    })
  })
})

describe('a person with an empty /attention response (AC9)', () => {
  it('still renders the figure, with a "sem dado" note, no lag sentence, and the mentions row rendered from /timeline', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/attention': attentionData([]),
        '/timeline': timelineData([timelineBucket('2026-08-15', 6), timelineBucket('2026-08-16', 2)]),
      })
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'bolsonaro' } })
      await flush()
      const combined = String(els.attentionChart.innerHTML) + ' ' + String(els.attentionNote.textContent)
      assert.match(combined, /sem dado de pageviews para esta pessoa/)
      assert.doesNotMatch(combined, /dias antes|mesmo dia caíram|os dois picos caíram/)
      assert.match(els.attentionChart.innerHTML, /data-row="mentions"/, 'the mentions row still renders normally from /timeline')
    })
  })
})

// Spec §3 rule 3: padding is only ever needed on the /attention side. A UTC day present in the
// mentions axis but missing from /attention's own series (not every day backfilled) is padded
// to { day, views: 0 } here -- distinct from AC9's fully-empty case, this exercises a *mixed*
// series where only some days are missing.
describe('a day missing from /attention but present in /timeline is padded to zero views (spec §3.3)', () => {
  it('the lag sentence is computed against the padded series, not against the raw (shorter) /attention payload', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        // Mentions peak on the 14th; /attention only reports the 16th (the 14th and 15th are
        // missing, e.g. not yet backfilled), so those two days must be padded to views: 0
        // before peakDay runs, leaving the views peak on the 16th.
        '/attention': attentionData([{ day: '2026-08-16', views: 500 }]),
        '/timeline': timelineData([timelineBucket('2026-08-14', 40), timelineBucket('2026-08-15', 2), timelineBucket('2026-08-16', 2)]),
      })
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'lula' } })
      await flush()
      assert.match(els.attentionNote.textContent, /a imprensa veio 2 dias antes/)
      assert.doesNotMatch(els.attentionChart.innerHTML, /sem dado de pageviews para esta pessoa/, 'a partially-populated series is not the empty-/attention case')
    })
  })
})

describe('clicking a day column opens the docs card with that day (AC8)', () => {
  it('sends day=<column UTC date>, term="", the full kind set and the figure own source, owned by "attention"; a second click releases it', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/attention': attentionData([{ day: '2026-08-15', views: 100 }]),
        '/timeline': timelineData([timelineBucket('2026-08-15', 4)]),
        '/docs': { docs: [], total: 0 },
      })
      const docsCard = await import('../src/ui/docs-card.js')
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'lula', source: 'gdelt' } })
      await flush()
      const mark = [...els.attentionChart.querySelectorAll('[data-day]')].find((el: any) => el.dataset.day === '2026-08-15')
      assert.ok(mark, 'a day column must be reachable by its data-day stub')
      mark.fire('click')
      await flush()
      const docsUrl = calls.find((u) => u.includes('/docs'))
      assert.ok(docsUrl, 'picking a day must request /docs')
      const qs = new URL(docsUrl!, 'http://localhost').searchParams
      assert.equal(qs.get('day'), '2026-08-15')
      assert.equal(qs.get('term'), '')
      assert.equal(qs.get('kind'), 'word,hashtag,phrase')
      assert.equal(qs.get('source'), 'gdelt')
      assert.equal(els.docsDialog.open, true)
      assert.equal(docsCard.openedBy('attention'), true)
      mark.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, false, 'clicking the same day again releases the pick and closes the card')
    })
  })

  it('a day with zero mentions still opens the card', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/attention': attentionData([{ day: '2026-08-15', views: 100 }]),
        '/timeline': timelineData([timelineBucket('2026-08-15', 0)]),
        '/docs': { docs: [], total: 0 },
      })
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'lula' } })
      await flush()
      const mark = [...els.attentionChart.querySelectorAll('[data-day]')].find((el: any) => el.dataset.day === '2026-08-15')
      assert.ok(mark, 'a zero-mention day must still carry a clickable column')
      mark.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true, 'a day with zero mentions still opens the docs card')
    })
  })
})

describe('atlas.html carries the seventh figure card', () => {
  it('a <section class="figure ..." id="attention"> exists after #lenses, with eyebrow "Gráfico 7", a figure-key and a Como ler link to #atencao', () => {
    const html = atlasPage()
    const lensesIdx = html.indexOf('id="lenses"')
    const attentionIdx = html.indexOf('id="attention"')
    assert.ok(lensesIdx !== -1 && attentionIdx !== -1)
    assert.ok(lensesIdx < attentionIdx, '#attention must come after #lenses')
    assert.match(html, /<section class="figure[^"]*" id="attention"/)
    assert.match(html, /<span class="eyebrow">Gráfico 7<\/span>/)
    const attention = html.match(/id="attention"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(attention, /<dl class="figure-key"[^>]*>/, '#attention carries its own figure-key')
    assert.match(attention, /href="como-ler\.html#atencao"/)
  })
})
