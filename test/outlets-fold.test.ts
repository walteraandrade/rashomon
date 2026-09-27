import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { paintOutlets } from '../src/ui/render.js'
import { mergeOutlets } from '../src/ui/format.js'
import { withFakeDocument } from './fake-dom.js'

// A /sources row with no domain (a Bluesky doc's stored domain is its author's handle, which
// outletDomain in src/scoring.ts folds to null) reaches figure 2 keyed by its source name.
// It is a count the reader should see, never an outlet to focus on: a click would send
// domain=bluesky to /docs and open an empty card.

const rows = [
  { domain: 'g1.globo.com', source: 'gnews', label: 'g1', docs: 4, tone: null },
  { domain: null, source: 'bluesky', label: null, docs: 9, tone: null },
]

describe('a host-less /sources row in figure 2', () => {
  it('mergeOutlets keys it by its source name, so the painter can tell it from a host', () => {
    const merged = mergeOutlets(rows, [])
    const fold = merged.find((r) => r.domain === 'bluesky')
    assert.ok(fold)
    assert.deepEqual(fold.sources, ['bluesky'])
    assert.equal(fold.docs, 9)
  })

  it('paintOutlets draws it as a static row with the count and no data-domain, while a real host stays a button', () => {
    const markup = withFakeDocument(['domainLabel', 'outletList'], (els) => {
      paintOutlets({ rows, testimony: null, domain: 'all', onPick: () => {} })
      return els.outletList.innerHTML
    })
    assert.match(markup, /<button class="outlet[^"]*" data-domain="g1.globo.com"/)
    assert.match(markup, /<span class="outlet is-static"[^>]*><span class="d">bluesky<\/span><span class="n">9<\/span>/)
    assert.doesNotMatch(markup, /data-domain="bluesky"/)
    assert.equal((markup.match(/data-domain=/g) ?? []).length, 1)
  })
})
