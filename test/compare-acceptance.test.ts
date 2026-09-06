import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Independent verification of issue #7's numbered acceptance criteria, written against the
// spec rather than against the builder's own code. Most criteria (AC2/3/4/5/6/7/8/11) are
// explicitly manual/browser checks per the spec's own test plan: compare.html is client-only
// static markup/JS with no server route, SQL, or export surface a node:test can import, and
// this repo has no jsdom/browser test runner. The criteria below are exactly the ones with an
// objectively-checkable static/textual surface.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const compareHtmlPath = join(root, 'public', 'compare.html')
const design5Path = join(root, 'public', 'design-5.html')

describe('compare people acceptance criteria (issue #7)', () => {
  it('AC1: public/compare.html exists and is self-contained (no build step, no external JS dependency beyond Google Fonts)', () => {
    assert.ok(existsSync(compareHtmlPath), 'public/compare.html must exist')
    const html = readFileSync(compareHtmlPath, 'utf8')
    assert.match(html, /^<!doctype html>/i, 'must be a plain static HTML document')

    const scriptSrcTags = [...html.matchAll(/<script[^>]*\bsrc=/gi)]
    assert.equal(scriptSrcTags.length, 0, 'no external <script src=...> tags allowed; JS must be inline')

    const linkTags = [...html.matchAll(/<link[^>]*>/gi)]
    for (const [tag] of linkTags) {
      assert.match(
        tag,
        /fonts\.googleapis\.com/,
        `only Google Fonts <link> tags are allowed as external dependencies, found: ${tag}`,
      )
    }
  })

  it('AC12: node chips never coerce a null tone; compare.html never reads or displays tone', () => {
    const html = readFileSync(compareHtmlPath, 'utf8')
    assert.ok(!/\btone\b/i.test(html), 'compare.html must not reference tone at all in this iteration')
    assert.doesNotMatch(html, /\.tone\s*(\?\?|\|\|)\s*0/, 'tone must never be coerced to 0')
  })

  it('AC9 (header placement): design-5.html places the compare-link immediately after .person-pick, before #stats', () => {
    const html = readFileSync(design5Path, 'utf8')
    const personPickIdx = html.indexOf('<div class="person-pick">')
    const compareLinkIdx = html.indexOf('<a class="compare-link"')
    const statsIdx = html.indexOf('id="stats"')
    assert.ok(personPickIdx !== -1, '.person-pick must exist in design-5.html')
    assert.ok(compareLinkIdx !== -1, '.compare-link anchor must exist in design-5.html')
    assert.ok(statsIdx !== -1, '#stats must exist in design-5.html')
    assert.ok(personPickIdx < compareLinkIdx, 'compare-link must come after .person-pick')
    assert.ok(compareLinkIdx < statsIdx, 'compare-link must come before #stats')
    assert.match(
      html.slice(compareLinkIdx, compareLinkIdx + 200),
      /href="compare\.html"[^<]*>comparar pessoas</,
      'compare-link anchor must point to compare.html with the pt-BR label "comparar pessoas"',
    )
  })
})
