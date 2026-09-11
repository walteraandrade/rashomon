import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { app } from '../src/server.js'
import { VERCEL_INSIGHTS } from './pages.js'

// public/bundle.js is a build artifact committed to the repository, because vercel.json keeps
// `buildCommand: null` and Vercel therefore serves public/ as files. That is the whole reason
// this file exists: a committed artifact can silently fall behind its source, and the page
// would keep serving the stale bundle with nothing failing. So the bundle's freshness is a
// tested invariant, not a habit someone has to remember. `pnpm build` regenerates it.
describe('public/bundle.js stays in step with src/ui', () => {
  const out = mkdtempSync(join(tmpdir(), 'rashomon-bundle-'))
  after(() => rmSync(out, { recursive: true, force: true }))

  it('is byte-identical to a fresh build of src/ui/app.ts', () => {
    const fresh = join(out, 'bundle.js')
    execFileSync(
      'node_modules/.bin/esbuild',
      ['src/ui/app.ts', '--bundle', '--minify', '--format=esm', '--target=es2022', `--outfile=${fresh}`, '--log-level=warning'],
      { stdio: 'pipe' },
    )
    assert.equal(
      readFileSync('public/bundle.js', 'utf8'),
      readFileSync(fresh, 'utf8'),
      'public/bundle.js is stale: a module under src/ui changed without a rebuild. Run `pnpm build` and commit the result.',
    )
  })

  it('is what design-5.html loads, and the only script it loads', () => {
    const html = readFileSync('public/design-5.html', 'utf8')
    // Vercel Web Analytics is a platform tag, not a module of this repo: it ships no code we
    // author and is served by the host, so it is excluded from the bundle's single-script rule.
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)]
      .map(([, src]) => src)
      .filter((src) => src !== VERCEL_INSIGHTS)
    assert.deepEqual(srcs, ['./bundle.js'])
  })

  it('is served, and the TypeScript sources it is built from are not', async () => {
    const bundle = await app.request('/bundle.js')
    assert.equal(bundle.status, 200)
    assert.match(bundle.headers.get('content-type') ?? '', /javascript/)
    // The ten modules live in src/ui as the source of truth: every front-end test imports them
    // directly, and atlas-modules-acceptance.test.ts pins their import graph. They are
    // TypeScript, so no browser could run them -- public/ must not ship them at all.
    for (const file of ['api.ts', 'app.ts', 'format.ts', 'layout.ts', 'render.ts', 'state.ts', 'figures/atlas.ts', 'figures/testimony.ts', 'figures/compare.ts', 'figures/week.ts']) {
      assert.equal((await app.request(`/js/${file}`)).status, 404, `/js/${file} must not be served`)
      assert.equal((await app.request(`/${file}`)).status, 404, `/${file} must not be served`)
    }
  })
})
