import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'

// Re-derivation of issue #28's acceptance criteria after issue #37 split design-5.html into
// public/js/*.js modules + public/atlas.css. The old version of this file grepped
// design-5.html's inline <script> as text for function bodies (`const packPass = ...`,
// `$('search').addEventListener(...)`); that pattern is exactly what issue #37 removed, since
// those functions are now real, importable modules with their own unit tests:
//  - packing/overflow: test/layout.test.ts (pack/packPass, imported from public/js/layout.js)
//  - pt-BR source labels ("todas as fontes", never raw "all"): test/format.test.ts
//  - bskyUrl: test/bsky-link.test.ts
// Issue #37 AC3 also forbids any test from reading design-5.html as text, including a regex
// against its HTTP response body -- that markup shape is asserted structurally instead, by
// test/atlas-modules-acceptance.test.ts's style= and import-graph checks. This file keeps only
// status/content-type checks on served routes, plus atlas.css's own content (not design-5's).

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const legacyPath = join(root, 'public', 'atlas-legacy.html')

describe('unified atlas acceptance criteria (issue #28), re-verified after the issue #37 module split', () => {
  it('GET / serves the atlas as HTML, not a build artifact', async () => {
    const res = await app.request('/')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/html/)
  })

  it('the extracted stylesheet and every JS module are served with the right mime type', async () => {
    const css = await app.request('/atlas.css')
    assert.equal(css.status, 200)
    assert.match(css.headers.get('content-type') ?? '', /text\/css/)
    for (const file of ['api.js', 'format.js', 'layout.js', 'render.js', 'state.js']) {
      const res = await app.request(`/js/${file}`)
      assert.equal(res.status, 200, `/js/${file} must be served`)
      assert.match(res.headers.get('content-type') ?? '', /javascript/, `/js/${file} must be served with a JavaScript content type`)
    }
  })

  it('legacy atlas remains reachable and links back to root', async () => {
    assert.ok(existsSync(legacyPath), 'public/atlas-legacy.html must exist')
    const legacyRes = await app.request('/atlas-legacy.html')
    assert.equal(legacyRes.status, 200)
    assert.match(legacyRes.headers.get('content-type') ?? '', /text\/html/)
    // atlas-legacy.html is intentionally kept as a single reference file with no module
    // surface (CLAUDE.md), so this is the one legitimate case left for a text match -- it is
    // not design-5.html, and this reads the file directly, not an HTTP response body.
    assert.match(readFileSync(legacyPath, 'utf8'), /class="brand" href="\/"/, 'legacy brand must link back to the new atlas')
  })

  it('archived design alternatives moved out of public/ are no longer served', async () => {
    for (const path of ['/design-1.html', '/design-2.html', '/design-3.html', '/design-4.html', '/design-6.html', '/designs.html', '/graph-lab.html', '/graph-circle-lab.html']) {
      const res = await app.request(path)
      assert.equal(res.status, 404, `${path} must 404 now that it lives in docs/designs/, not public/`)
    }
  })

  it('atlas.css keeps the source segment usable on mobile widths (issue #28)', () => {
    const css = readFileSync(join(root, 'public', 'atlas.css'), 'utf8')
    assert.match(css, /\.source-field\s*\{\s*max-width:\s*100%;\s*\}/)
    assert.match(css, /\.segment\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/)
  })
})
