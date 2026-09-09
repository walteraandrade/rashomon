import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { app } from '../src/server.js'

// public/bundle.js is a build artifact committed to the repository, because vercel.json keeps
// `buildCommand: null` and Vercel therefore serves public/ as files. That is the whole reason
// this file exists: a committed artifact can silently fall behind its source, and the page
// would keep serving the stale bundle with nothing failing. So the bundle's freshness is a
// tested invariant, not a habit someone has to remember. `pnpm build` regenerates it.
describe('public/bundle.js stays in step with public/js', () => {
  const out = mkdtempSync(join(tmpdir(), 'rashomon-bundle-'))
  after(() => rmSync(out, { recursive: true, force: true }))

  it('is byte-identical to a fresh build of public/js/app.js', () => {
    const fresh = join(out, 'bundle.js')
    execFileSync(
      'node_modules/.bin/esbuild',
      ['public/js/app.js', '--bundle', '--minify', '--format=esm', '--target=es2022', `--outfile=${fresh}`, '--log-level=warning'],
      { stdio: 'pipe' },
    )
    assert.equal(
      readFileSync('public/bundle.js', 'utf8'),
      readFileSync(fresh, 'utf8'),
      'public/bundle.js is stale: a module under public/js changed without a rebuild. Run `pnpm build` and commit the result.',
    )
  })

  it('is what design-5.html loads, and the only script it loads', () => {
    const html = readFileSync('public/design-5.html', 'utf8')
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(([, src]) => src)
    assert.deepEqual(srcs, ['./bundle.js'])
  })

  it('is served, and so are the source modules the tests import', async () => {
    const bundle = await app.request('/bundle.js')
    assert.equal(bundle.status, 200)
    assert.match(bundle.headers.get('content-type') ?? '', /javascript/)
    // The six modules stay in public/js as the source of truth: every front-end test imports
    // them directly, and atlas-modules-acceptance.test.ts pins their import graph.
    for (const file of ['api.js', 'app.js', 'format.js', 'layout.js', 'render.js', 'state.js']) {
      const res = await app.request(`/js/${file}`)
      assert.equal(res.status, 200, `/js/${file} must still be served`)
    }
  })
})
