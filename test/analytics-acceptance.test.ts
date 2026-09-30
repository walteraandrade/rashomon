import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ANALYTICS_PAGES, VERCEL_INSIGHTS_TAG, appTemplate } from './pages.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('Vercel Web Analytics', () => {
  it('analytics tag is in app.html once, deferred, right before </body>', () => {
    const html = appTemplate()
    assert.equal(html.split(VERCEL_INSIGHTS_TAG).length - 1, 1, 'app.html must carry the analytics tag exactly once')
    assert.match(html, new RegExp(`${VERCEL_INSIGHTS_TAG}\\s*</body>`), 'app.html must load it last, after the page markup')
  })

  it('no route repeats the tag, so every page has it exactly once', () => {
    for (const file of ANALYTICS_PAGES) {
      const source = readFileSync(join(root, file), 'utf8')
      assert.equal(source.includes('/_vercel/insights'), false, `${file} must not carry the analytics tag`)
    }
  })

  it('the tag is host-served and absolute: no bundling, no third-party origin', () => {
    assert.match(VERCEL_INSIGHTS_TAG, /src="\/_vercel\//)
    assert.doesNotMatch(VERCEL_INSIGHTS_TAG, /https?:/)
  })
})
