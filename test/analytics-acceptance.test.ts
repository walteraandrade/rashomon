import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ANALYTICS_PAGES, VERCEL_INSIGHTS_TAG } from './pages.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (page: string) => readFileSync(join(root, 'public', page), 'utf8')

describe('Vercel Web Analytics', () => {
  it('every landing page carries the tag exactly once, deferred, right before </body>', () => {
    for (const page of ANALYTICS_PAGES) {
      const html = read(page)
      const hits = html.split(VERCEL_INSIGHTS_TAG).length - 1
      assert.equal(hits, 1, `${page} must carry the analytics tag exactly once`)
      assert.match(html, new RegExp(`${VERCEL_INSIGHTS_TAG}\\s*</body>`), `${page} must load it last, after the page markup`)
    }
  })

  it('the tag is host-served and absolute: no bundling, no third-party origin', () => {
    // /_vercel/* is Vercel's own path. A relative src would 404, and an external origin would
    // put a third party in the page's critical path for nothing.
    assert.match(VERCEL_INSIGHTS_TAG, /src="\/_vercel\//)
    assert.doesNotMatch(VERCEL_INSIGHTS_TAG, /https?:/)
  })
})
