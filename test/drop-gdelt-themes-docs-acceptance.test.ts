import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { docsText } from './docs.js'

// Issue #108's documentation-facing acceptance criteria (AC17-19): kind drops 'theme' as an
// accepted value everywhere it is documented, `pnpm purge themes` is documented for what it
// clears, the two legacy pages are documented as gone rather than reachable, and the two
// source comments (CLAUDE.md, src/ui/api.ts) that used to justify keeping theme data around
// are corrected to match. Facts are asserted against docsText (every page at once), never
// against one page's exact wording, except for CLAUDE.md and src/ui/api.ts themselves, which
// are not user-facing docs pages and are read directly the way any other source/config file is.

const root = dirname(dirname(fileURLToPath(import.meta.url)))

describe('issue #108 docs facts', () => {
  it("AC17: kind's documented accepted values are exactly hashtag, word and phrase, never theme", () => {
    const m = /`kind`:\s*([^.\n]*)/.exec(docsText)
    assert.ok(m, 'no page documents what values `kind` accepts')
    const values = [...m![1].matchAll(/`(\w+)`/g)].map((x) => x[1]).sort()
    assert.deepEqual(values, ['hashtag', 'phrase', 'word'], "docs/api.md's kind line must list exactly hashtag, word and phrase")
  })

  it('AC17: pnpm purge themes is documented, and what it clears is documented alongside it', () => {
    const idx = docsText.indexOf('purge themes')
    assert.ok(idx > -1, 'no page documents `pnpm purge themes`')
    const around = docsText.slice(Math.max(0, idx - 200), idx + 400)
    assert.match(around, /extra_terms/, 'the purge themes docs must mention the extra_terms column it clears')
    assert.match(around, /kikori:q8/, 'the purge themes docs must mention the pre-revision kikori:q8-style testimony rows it clears')
  })

  it('AC17: the docs say public/index.html is gone, not a reachable legacy UI', () => {
    const idx = docsText.indexOf('index.html')
    assert.ok(idx > -1, 'no page mentions public/index.html at all')
    const around = docsText.slice(Math.max(0, idx - 80), idx + 160)
    assert.doesNotMatch(around, /reachable only by name/i, 'docs must stop describing index.html as reachable legacy UI')
    assert.match(around, /(gone|removed|deleted|no longer)/i, 'docs must say index.html is gone')
  })

  it('AC18: CLAUDE.md no longer mentions GDELT theme codes anywhere, atlas or API', () => {
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    assert.doesNotMatch(claude, /theme/i, 'CLAUDE.md must not describe theme codes staying in the atlas or the API any more')
  })

  it('AC18: CLAUDE.md no longer describes public/index.html as reachable legacy UI', () => {
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    assert.doesNotMatch(claude, /index\.html[^\n]*reachable/i, 'CLAUDE.md must not describe index.html as reachable')
    assert.doesNotMatch(claude, /legacy UI, reachable only by name/i)
  })

  it("AC19: src/ui/api.ts's ATLAS_KINDS comment no longer claims theme codes stay in the API or show on atlas-legacy.html", () => {
    const apiTs = readFileSync(join(root, 'src/ui/api.ts'), 'utf8')
    assert.doesNotMatch(apiTs, /stay in the API/i)
    assert.doesNotMatch(apiTs, /atlas-legacy\.html/)
  })

  it('AC19: ATLAS_KINDS itself is unchanged', () => {
    const apiTs = readFileSync(join(root, 'src/ui/api.ts'), 'utf8')
    assert.match(apiTs, /ATLAS_KINDS = 'word,hashtag,phrase'/)
  })
})
