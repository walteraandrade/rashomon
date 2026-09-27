import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attentionParams } from '../src/ui/api.js'
import { clearScopes } from '../src/ui/state.js'
import { flush, jsonResponse, routeFetch, withFiguresDom } from './fake-mount-dom.js'
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

// Validator B1: #attentionChart is #attention's content box, without the figure's own
// horizontal padding; measuring the section instead draws the chart wider than its card.
describe('the chart is measured off #attentionChart, never off the wider #attention section (B1)', () => {
  it('the painted svg width matches attentionChart.clientWidth, not attention.clientWidth', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/attention': attentionData([{ day: '2026-08-15', views: 100 }]),
        '/timeline': timelineData([timelineBucket('2026-08-15', 4)]),
      })
      els.attention.clientWidth = 900
      els.attentionChart.clientWidth = 620
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'lula' } })
      await flush()
      const width = String(els.attentionChart.innerHTML).match(/class="attention-svg"[^>]*\bwidth="(\d+)"/)?.[1]
      assert.equal(width, '620', 'the svg must be drawn at the chart\'s own content-box width')
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

  it('a background click on the chart (not a day column) releases the pick and resets aria-pressed (AC8)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/attention': attentionData([{ day: '2026-08-15', views: 100 }]),
        '/timeline': timelineData([timelineBucket('2026-08-15', 4)]),
        '/docs': { docs: [], total: 0 },
      })
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'lula' } })
      await flush()
      const mark = [...els.attentionChart.querySelectorAll('[data-day]')].find((el: any) => el.dataset.day === '2026-08-15')
      assert.ok(mark, 'a day column must be reachable by its data-day stub')
      mark.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      assert.match(String(els.attentionChart.innerHTML), /data-day="2026-08-15"[^>]*aria-pressed="true"/)
      els.attentionChart.fire('click', { target: { closest: () => null } })
      await flush()
      assert.equal(els.docsDialog.open, false, 'a background click releases the pick and closes the card')
      assert.match(String(els.attentionChart.innerHTML), /data-day="2026-08-15"[^>]*aria-pressed="false"/)
    })
  })

  it('pressing Escape releases the pick and closes the card (AC8)', async () => {
    await withFiguresDom(async (els, calls, fireDocumentKeydown) => {
      clearScopes()
      routeFetch(calls, {
        '/attention': attentionData([{ day: '2026-08-15', views: 100 }]),
        '/timeline': timelineData([timelineBucket('2026-08-15', 4)]),
        '/docs': { docs: [], total: 0 },
      })
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'lula' } })
      await flush()
      const mark = [...els.attentionChart.querySelectorAll('[data-day]')].find((el: any) => el.dataset.day === '2026-08-15')
      assert.ok(mark, 'a day column must be reachable by its data-day stub')
      mark.fire('click')
      await flush()
      assert.equal(els.docsDialog.open, true)
      fireDocumentKeydown('Escape')
      await flush()
      assert.equal(els.docsDialog.open, false, 'Escape must release the pick and close the card')
    })
  })
})

// Validator round-2 SHOULD (a/b/c): the two independent fetches (mentions, attention) can
// settle in either order, fail independently, or race a person/source change. Each must never
// paint a state that mixes the wrong recorte or misreports "no data" for an outage.
describe('the two independent fetches never mix recortes or misreport an outage as empty data', () => {
  // A routeFetch variant that lets /timeline settle well before /attention, so a test can flush
  // past the first without the second, and observe the views row still marked as loading.
  const staggeredFetch = (fetchCalls: string[], fast: Record<string, unknown>, slowPath: string, slowData: unknown) => {
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input)
      fetchCalls.push(url)
      const path = new URL(url, 'http://localhost').pathname
      if (path.endsWith(slowPath)) {
        await new Promise((r) => setTimeout(r, 80))
        return jsonResponse(slowData) as unknown as Response
      }
      for (const [suffix, data] of Object.entries(fast)) if (path.endsWith(suffix)) return jsonResponse(data) as unknown as Response
      return jsonResponse({}) as unknown as Response
    }) as typeof fetch
  }

  it('/timeline resolving first never states "sem dado de pageviews" while /attention is still in flight', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      staggeredFetch(calls, { '/timeline': timelineData([timelineBucket('2026-08-15', 4)]) }, '/attention', attentionData([{ day: '2026-08-15', views: 900 }]))
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'lula' } })
      await flush(20)
      assert.doesNotMatch(String(els.attentionChart.innerHTML), /sem dado de pageviews para esta pessoa/, '/attention has not answered yet -- that is not the same as an empty response')
      assert.match(String(els.attentionChart.innerHTML), /data-row="mentions"/, 'the mentions row already paints from the settled /timeline')
      await flush(90)
      assert.doesNotMatch(String(els.attentionChart.innerHTML), /sem dado de pageviews para esta pessoa/, 'once /attention settles with real views, still not the empty-pageviews case')
    })
  })

  it('an /attention failure states its own error note, never "sem dado de pageviews" (an outage is not "no wikipedia page")', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        const url = String(input)
        calls.push(url)
        const path = new URL(url, 'http://localhost').pathname
        if (path.endsWith('/attention')) return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
        if (path.endsWith('/timeline')) return jsonResponse(timelineData([timelineBucket('2026-08-15', 4)])) as unknown as Response
        return jsonResponse({}) as unknown as Response
      }) as typeof fetch
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'lula' } })
      await flush(40)
      assert.match(String(els.attentionChart.innerHTML), /Não foi possível carregar os pageviews\./)
      assert.doesNotMatch(String(els.attentionChart.innerHTML), /sem dado de pageviews para esta pessoa/, 'an outage must not be misreported as "no wikipedia page"')
      assert.match(String(els.attentionChart.innerHTML), /data-row="mentions"/, 'the mentions row is untouched by the views row error')
    })
  })

  it('a person change while /attention is still in flight never paints the new person\'s mentions against the previous person\'s stale views', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      routeFetch(calls, {
        '/timeline': timelineData([timelineBucket('2026-08-15', 4)]),
        '/attention': attentionData([{ day: '2026-08-15', views: 12345 }]),
      })
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'lula' } })
      await flush(20)
      assert.match(String(els.attentionChart.innerHTML), /12\.345/, 'lula\'s own views must have painted once')

      staggeredFetch(calls, { '/timeline': timelineData([timelineBucket('2026-08-20', 7)]) }, '/attention', attentionData([{ day: '2026-08-20', views: 999 }]))
      els.attentionPerson.value = 'bolsonaro'
      els.attentionPerson.fire('change')
      // debounce(load) waits ~140ms before the reload even starts; the fast /timeline settles
      // soon after, well before the slow /attention (+80ms of its own).
      await flush(180)
      assert.doesNotMatch(String(els.attentionChart.innerHTML), /12\.345/, "lula's stale views must not survive the reset")
      assert.match(String(els.attentionChart.innerHTML), /class="ghost"/, "the views row ghosts on its own while /attention for the new person is still in flight")
      await flush(100)
      assert.match(String(els.attentionChart.innerHTML), /999/, "bolsonaro's own views paint once /attention settles")
    })
  })

  // Validator S1a: each fetch is tagged with the person|source key it was requested for, so a
  // still-in-flight request that settles after the switch -- however late, even inside the
  // reload debounce window -- is recognized as stale and never painted.
  it('a slow /attention for the previous person settling inside the reload debounce must not paint its stale views (S1a)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
      globalThis.fetch = (async (input: unknown) => {
        const url = String(input)
        calls.push(url)
        const path = new URL(url, 'http://localhost').pathname
        if (path.includes('/attention')) {
          const views = path.includes('/lula/') ? 12345 : 999
          await new Promise((r) => setTimeout(r, 100))
          return jsonResponse(attentionData([{ day: '2026-08-15', views }])) as unknown as Response
        }
        if (path.includes('/timeline')) {
          const count = path.includes('/lula/') ? 4 : 7
          return jsonResponse(timelineData([timelineBucket('2026-08-15', count)])) as unknown as Response
        }
        return jsonResponse({}) as unknown as Response
      }) as typeof fetch
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'lula' } })
      // Switch before lula's /attention (100ms) resolves; figure.reload()'s own 140ms debounce
      // means lula's slow response lands squarely inside the window before bolsonaro's own load
      // even starts.
      els.attentionPerson.value = 'bolsonaro'
      els.attentionPerson.fire('change')
      await flush(120)
      assert.doesNotMatch(String(els.attentionChart.innerHTML), /12\.345/, "lula's stale views must not paint however late they settle after the switch")
      await flush(150)
      assert.match(String(els.attentionChart.innerHTML), /999/, "bolsonaro's own views paint once its own /attention settles")
    })
  })

  // Validator S1b: figure.ts's own repaint() (wired to the ResizeObserver on #attentionChart)
  // never gates on in-flight state; without the key check it would redraw the last *successful*
  // fetch, which can still be the previous person's, while the new person's own request is
  // still pending.
  it('a resize repaint while the new person\'s /attention is still pending must not restore the previous person\'s stale views (S1b)', async () => {
    await withFiguresDom(async (els, calls) => {
      clearScopes()
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
        '/attention': attentionData([{ day: '2026-08-15', views: 12345 }]),
        '/timeline': timelineData([timelineBucket('2026-08-15', 4)]),
      })
      const { mount } = await import('../src/ui/figures/attention.js')
      mount(els.attention, { people, initial: { person: 'lula' } })
      await flush()
      assert.match(String(els.attentionChart.innerHTML), /12\.345/, 'lula\'s own views must have painted once')
      const chartObserver = captured.find((c) => c.target === els.attentionChart)
      assert.ok(chartObserver, 'the attention instance must observe #attentionChart for resize')

      staggeredFetch(calls, { '/timeline': timelineData([timelineBucket('2026-08-20', 7)]) }, '/attention', attentionData([{ day: '2026-08-20', views: 999 }]))
      els.attentionPerson.value = 'bolsonaro'
      els.attentionPerson.fire('change')
      // Past the 140ms debounce plus bolsonaro's own fast /timeline, still short of its own
      // slow (+80ms) /attention: bolsonaro's mentions are up, his views are still in flight.
      await flush(180)
      assert.match(String(els.attentionChart.innerHTML), /data-row="mentions"/, "bolsonaro's mentions must have painted while his own /attention is still in flight")
      assert.doesNotMatch(String(els.attentionChart.innerHTML), /12\.345/, "lula's stale views must not survive the switch on their own")

      els.attentionChart.clientWidth = 400
      chartObserver!.cb()
      assert.doesNotMatch(String(els.attentionChart.innerHTML), /12\.345/, "a resize repaint while bolsonaro's own /attention is still pending must not restore lula's stale views")
      // Let bolsonaro's own (staggered) /attention settle before the test tears the dom down.
      await flush(60)
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
