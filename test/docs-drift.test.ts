import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectors, defaultSources } from '../src/collectors/index.js'
import { SOURCES } from '../src/query.js'
import { docPageText, docPages, docsText, sourceTable } from './docs.js'
import './close.js'

// One drift check for every collector, driven by the registry in src/collectors/index.ts.
// A new source cannot ship undocumented, and no page has to keep a fixed shape for that
// guarantee to hold. This replaces the per-issue "README contains <string>" criteria,
// which asserted where the prose sat rather than what it said. Below it, the documented facts
// each issue pinned: asserted against docsText (every page at once), never against one page's
// exact wording.

const root = dirname(dirname(fileURLToPath(import.meta.url)))

describe('docs drift', () => {
  const sources = Object.keys(collectors)
  const isDefault = (source: string) => defaultSources.some((s) => s === source)

  // SOURCES is hand-written, and since issue #108 `pnpm purge <source>` rejects anything
  // missing from it instead of purging zero rows. A collector left out of the list is now a
  // source nobody can purge, so the two have to be the same set.
  it('SOURCES names exactly the registered collectors', () => {
    assert.deepEqual([...SOURCES].sort(), sources.slice().sort())
  })

  it('every collector has a row in the source table', () => {
    for (const source of sources) {
      const row = sourceTable.get(source)
      assert.ok(row, `docs/sources.md has no row for '${source}'`)
      assert.notEqual(row.what, '', `the row for '${source}' says nothing about what it collects`)
    }
  })

  it('the source table agrees with defaultSources about what runs by default', () => {
    for (const source of sources) {
      const row = sourceTable.get(source)
      assert.ok(row, `docs/sources.md has no row for '${source}'`)
      assert.equal(row.byDefault, isDefault(source), `docs/sources.md and defaultSources disagree about '${source}'`)
    }
  })

  it('the source table lists no collector that does not exist', () => {
    for (const source of sourceTable.keys()) {
      assert.ok(sources.includes(source), `docs/sources.md documents '${source}', which no collector provides`)
    }
  })

  it('every collector is a documented value of the source filter', () => {
    const api = docPageText.get('docs/api.md') ?? ''
    for (const source of sources) assert.match(api, new RegExp('`' + source + '`'), `docs/api.md never lists '${source}' as a source value`)
  })

  it('every page is linked from the README', () => {
    const readme = docPageText.get('README.md') ?? ''
    // sources-research.md is a research log, reached from an issue, not from the landing page.
    for (const page of docPages.filter((p) => p !== 'README.md' && p !== 'docs/sources-research.md')) {
      assert.ok(readme.includes(page), `${page} is linked from nowhere`)
    }
  })

  it('the docs name every tracked seed field a collector reads', () => {
    for (const field of ['camaraId', 'senadoId', 'exclude']) {
      assert.match(docsText, new RegExp(field), `no page documents the '${field}' seed field`)
    }
  })
})

describe('documented facts per collector', () => {
  it('senado (issue #25): a default source, its open-data host and the senadoId seed field', () => {
    assert.equal(sourceTable.get('senado')?.byDefault, true, 'docs/sources.md must show senado as a default source')
    assert.match(docPageText.get('docs/api.md') ?? '', /`senado`/, 'docs/api.md must list senado as a source filter value')
    assert.match(docsText, /senadoId/)
    assert.match(docsText, /dadosabertos\.senado\.leg\.br/)
  })

  it('camara (issue #24): camaraId, the open-data host, and camara as a default source', () => {
    assert.match(docsText, /camaraId/)
    assert.match(docsText, /dadosabertos\.camara\.leg\.br/)
    assert.equal(sourceTable.get('camara')?.byDefault, true)
  })

  it('press families (issue #22): the three feed sets, defaultSources membership and the RDF/Planalto exclusion', () => {
    const api = docPageText.get('docs/api.md') ?? ''
    for (const source of ['juridico', 'oficial', 'nicho']) assert.match(api, new RegExp('`' + source + '`'))
    assert.match(docsText, /noticias\.stf\.jus\.br/)
    assert.match(docsText, /conjur\.com\.br/)
    assert.match(docsText, /jota\.info/)
    assert.match(docsText, /agenciabrasil\.ebc\.com\.br/)
    assert.match(docsText, /cartacapital\.com\.br/)
    assert.match(docsText, /defaultSources/)
    assert.match(docsText, /RDF/)
    assert.match(docsText, /Planalto/)
  })

  it('bounded downloads: 32 MB and 128 MB are both documented, and an oversize GKG slot is skipped without being marked done', () => {
    assert.match(docsText, /32\s*MB/)
    assert.match(docsText, /128\s*MB/)
    assert.match(docsText, /gkg_files/)
    assert.match(docsText, /retr(y|ies|ied)/i)
    assert.match(docsText, /(without being marked done|not.*marked done|skipped)/i)
  })
})

describe('documented facts per route', () => {
  it('/api/compare (issue #93 AC15): the route, its a/b parameters, and the null-vs-"name" distinction', () => {
    assert.match(docsText, /\/api\/compare/)
    assert.match(docsText, /a=<personId>&b=<personId>|`a`.*`b`|`a`\/`b`/)
    // the null-vs-"name" distinction: an absent term reads null, a hidden-own-name term reads
    // the literal string "name" -- both facts must be stated, not merely the word "null"
    assert.match(docsText, /`?null`?\s*\(measured[^)]*\)|null.*measured|measured.*null/)
    assert.match(docsText, /"name"/)
    assert.match(docsText, /own name word/)
  })

  it('/api/people/:id/week (issue #147 AC21/AC22): calendar days, BRT, about + per-day terms, rolling 6h cache', () => {
    assert.match(docsText, /\/api\/people\/:id\/week/)
    assert.match(docsText, /America\/Sao_Paulo/)
    assert.match(docsText, /calendar day/)
    assert.match(docsText, /not required to equal/)
    assert.match(docsText, /optional.*`day`|`day` is optional/)
    assert.match(docsText, /week.*rolling 6h|rolling 6h class/)
    assert.doesNotMatch(docsText, /`week`[\s\S]{0,40}1h trend|trend class[\s\S]{0,40}`week`/)
  })
})

describe('issue #112 AC12: docs/operations.md states the dependency and size facts', () => {
  it('AC12: @huggingface/transformers is documented as required only by pnpm score and shipped as optional', () => {
    assert.match(docsText, /@huggingface\/transformers[\s\S]{0,80}required only by[\s\S]{0,20}pnpm score/, 'operations docs must say the package is required only by pnpm score')
    assert.match(docsText, /optionalDependencies/, 'operations docs must say it ships as an optional dependency')
  })

  it('AC12: the deployed /api function is documented as excluded from the import graph that reaches the model loader', () => {
    assert.match(docsText, /deployed[\s\S]{0,20}\/api[\s\S]{0,120}never reaches the model loader/i)
  })

  it('AC12: the measured before/after size of .vercel/output/functions/api/index.func is recorded, and after is smaller', () => {
    assert.match(docsText, /index\.func/, 'the docs must name the measured artifact')
    const bytes = [...docsText.matchAll(/before this split,[\s\S]{0,80}?was\s+([\d,]+)\s+bytes[\s\S]{0,200}?after,\s+it is\s+([\d,]+)\s+bytes/g)]
    assert.equal(bytes.length, 1, 'the docs must record one before/after size pair for index.func, in prose next to each other')
    const [, before, after] = bytes[0]
    assert.ok(Number(before.replace(/,/g, '')) > Number(after.replace(/,/g, '')), 'after must be recorded as smaller than before')
    assert.match(docsText, /onnxruntime-node/, 'the docs must name onnxruntime-node among what the before build carried')
    assert.match(docsText, /carries none of them/, 'the docs must state the after build carries none of the excluded packages')
  })
})

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

  it('AC18: CLAUDE.md no longer claims GDELT theme codes stay in the atlas or the API', () => {
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    assert.doesNotMatch(claude, /theme codes[^\n]*(stay|remain) in the API/i, 'CLAUDE.md must not describe theme codes staying in the API any more')
    assert.doesNotMatch(claude, /`kind`[^\n]*`theme`/, 'CLAUDE.md must not list theme as a kind value')
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
