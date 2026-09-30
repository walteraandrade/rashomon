import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { docsText } from './docs.js'
import { pageMarkup } from './pages.js'

// The docs and the prerendered page carry the facts the components rely on; the components'
// own behaviour is in test/components/.

describe('figure 10 querystring keys are documented (issue #215)', () => {
  it('names the persistence figure id, person and limit bare or prefixed, and weeks prefixed only', () => {
    assert.match(docsText, /persistence\.weeks/)
    assert.match(docsText, /persistence[\s\S]{0,600}\bperson\b[\s\S]{0,120}\blimit\b[\s\S]{0,200}(bare|prefixed)/i)
    assert.match(docsText, /persistence[\s\S]{0,800}\bweeks\b[\s\S]{0,250}(prefixed only|no bare|only (the )?prefixed|never (a )?bare)/i)
  })
})

describe('figure 9 is a Svelte component', () => {
  it('documents that comention is a Svelte component seeded from days, source, lean and min, sharing the single /api/people fetch (AC16)', () => {
    assert.match(docsText, /comention[\s\S]{0,300}Svelte component/i)
    assert.match(docsText, /Comention\.svelte/)
    assert.match(docsText, /comention[\s\S]{0,600}\bdays\b[\s\S]{0,120}\bsource\b[\s\S]{0,200}\blean\b[\s\S]{0,120}\bmin\b/i)
    assert.match(docsText, /comention[\s\S]{0,1200}\/api\/people[\s\S]{0,200}(once|single|shared|one fetch)/i)
  })
})

describe('figure 4 is a Svelte component (#292)', () => {
  it('documents that rising is a Svelte component seeded from bootData with person and source, and no longer a figures/*.ts mount', () => {
    assert.match(docsText, /Rising\.svelte/)
    assert.match(docsText, /rising[\s\S]{0,300}Svelte component/i)
    assert.match(docsText, /rising[\s\S]{0,600}\bperson\b[\s\S]{0,120}\bsource\b/i)
    assert.doesNotMatch(docsText, /figures\/rising/)
  })

  it('the prerendered page carries every figure 4 hook, after figure 3, with only person and source as controls', () => {
    const page = pageMarkup('/')
    for (const id of ['rising', 'risingTitle', 'risingPerson', 'risingSource', 'risingRuler', 'risingAbout']) assert.match(page, new RegExp(`id="${id}"`), `#${id} must be in the page`)
    assert.ok(page.indexOf('id="compare"') >= 0, '#compare must be in the page')
    assert.ok(page.indexOf('id="compare"') < page.indexOf('id="rising"'), '#rising must come after #compare')
    assert.match(page, /<section class="figure[^"]*" id="rising"/)
    const section = page.slice(page.indexOf('id="rising"'))
    const line = section.match(/<[^>]*class="[^"]*sentence-line[^"]*"[\s\S]*?<\/(?:p|div)>/)?.[0] ?? section.slice(0, 2500)
    for (const id of ['risingDays', 'risingBaseline', 'risingKind', 'risingLimit', 'risingMin']) assert.doesNotMatch(line, new RegExp(`id="${id}"`), `#${id} is not a control`)
  })
})
