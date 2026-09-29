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

  it('press families (issue #22): the three feed sets, defaultSources membership and RDF/Planalto support', () => {
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

  it('gkg names a download timeout distinct from every other collector\'s request timeout, and from the byte caps', () => {
    assert.match(docsText, /GKG_DOWNLOAD_TIMEOUT_MS/, 'the docs must name the gkg download timeout literal')
    assert.match(docsText, /300\s*000\s*ms|5\s*min/i, 'the docs must state the gkg download timeout value')
    assert.match(docsText, /REQUEST_TIMEOUT_MS/, 'the docs must name the request timeout every other collector carries')
    assert.match(docsText, /distinct from|not.*REQUEST_TIMEOUT_MS|different from/i, 'the docs must say the two timeouts are distinct')
  })

  // Issue #183, AC15: the download timeout is documented as its own ceiling, separate from the
  // byte caps (MAX_RESPONSE_BYTES/MAX_EXPANDED_BYTES), not merely distinct from REQUEST_TIMEOUT_MS.
  it('states the gkg download timeout is independent of the byte caps, not only of REQUEST_TIMEOUT_MS', () => {
    assert.match(
      docsText,
      /distinct from both `?REQUEST_TIMEOUT_MS`?\s+and\s+the\s+`?MAX_RESPONSE_BYTES`?\/`?MAX_EXPANDED_BYTES`?\s+byte caps|three independent ends/i,
      'the docs must state the download timeout is a ceiling separate from both byte caps, not only from REQUEST_TIMEOUT_MS',
    )
  })

  it('every collector\'s network read is timeout-bounded, not only gdelt/camara/senado/bluesky', () => {
    assert.match(docsText, /every collector's network read is.{0,20}timeout-bounded/i)
  })
})

describe('oficial\'s Planalto RDF feed is documented as included, not excluded', () => {
  // issue #213
  it('says Planalto is part of oficial, and that oficial (via rss.ts) reads an RDF feed', () => {
    assert.match(docsText, /oficial[\s\S]{0,400}Planalto/i, 'no page ties Planalto to the oficial family')
    assert.match(docsText, /(oficial|rss\.ts)[\s\S]{0,400}RDF/i, 'no page says oficial (or rss.ts) reads an RDF feed')
  })

  // issue #213
  it('no longer claims Planalto is unsupported/excluded or that rss.ts assumes RSS 2.0 for every feed', () => {
    assert.doesNotMatch(docsText, /Planalto[\s\S]{0,120}(unsupported|deliberately exclu[ií]d|is exclu[ií]d)/i)
    assert.doesNotMatch(docsText, /rss\.ts[\s\S]{0,120}assumes RSS 2\.0/i)
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

  it('/api/people/:id/lenses (issue #206 AC13): the route exists, a lens is domain/lean/source, and an invalid lens falls back to the full corpus', () => {
    assert.match(docsText, /\/api\/people\/:id\/lenses/)
    assert.match(docsText, /domain:<host>/)
    assert.match(docsText, /lean:<left\|right\|center>/)
    assert.match(docsText, /source:<name>/)
    // Specific enough that a generic "falls back to `all`" sentence elsewhere in the docs
    // (there is one, for the shared source/kind/domain/lean list parameters) cannot satisfy
    // it: this one must also say what the fallback actually is, the full corpus.
    assert.match(docsText, /falls? back to `?all`?[^.]{0,20}full corpus/i)
  })

  it('/api/people/:id/week (issue #147 AC21/AC22): calendar days, BRT, about + per-day terms, rolling 6h cache', () => {
    assert.match(docsText, /\/api\/people\/:id\/week/)
    assert.match(docsText, /America\/Sao_Paulo/)
    assert.match(docsText, /calendar day/)
    assert.match(docsText, /not required to equal/)
    assert.match(docsText, /optional.*`day`|`day` is optional/)
    assert.match(docsText, /^(?=.*\bweek\b)(?=.*rolling 6h).*$/im)
    assert.doesNotMatch(docsText, /`week`[\s\S]{0,40}1h trend|trend class[\s\S]{0,40}`week`/)
  })

  // issue #204
  it('docs/api.md documents country as a shared filter that defaults to br, not all', () => {
    assert.match(docsText, /`country`/)
    assert.match(docsText, /\bbr\b/)
    assert.match(docsText, /\bpt\b/)
    assert.match(docsText, /falls back to `?br`?|default.*differs|does not fall back to `?all`?/i)
  })

  // issue #204
  it('docs/api.md states the null-country keep/drop rule as a fact, not a code reference', () => {
    assert.match(docsText, /not yet classified|unclassified|null.?-?country/i)
    assert.match(docsText, /kept.*(default|`?all`?)|(default|`?all`?).*kept/i)
    assert.match(docsText, /dropped.*`?pt`?|`?pt`?.*drop/i)
  })

  // issue #204
  it('docs/api.md states the aggregate tables hold only the default country universe', () => {
    assert.match(docsText, /aggregate table[\s\S]{0,200}\b(br|default)\b/i)
    assert.match(docsText, /`?pt`?.*live|live.*`?pt`?/i)
  })

  it('docs/api.md documents the cross-route limit snap change caused by inserting 8 (issue #153)', () => {
    const api = docPageText.get('docs/api.md') ?? ''
    const section = api.slice(api.indexOf('## Enumerated integers'), api.indexOf('## Shared filters'))
    assert.match(section, /not just `week`|every route that reads `LIMITS`/, 'the limit paragraph must say the snap change reaches every LIMITS route, not only week')
    assert.match(section, /`\?limit=7`[\s\S]{0,60}reads as 8/, 'limit=7 now reading as 8 must be documented')
    assert.match(section, /`\?limit=10`[\s\S]{0,120}read as 8/, 'limit=10 now reading as 8 must be documented')
    assert.match(section, /\btie\b/, 'the tie-break that lands limit=10 on 8 rather than 12 must be stated')
  })

  it('docs/api.md states the day/published_at fold as one rule, not a self-contradiction (issue #153)', () => {
    const api = docPageText.get('docs/api.md') ?? ''
    const section = api.slice(api.indexOf('`day` is optional'), api.indexOf('## rising'))
    assert.match(section, /counts as today/, 'the fold itself must still be documented')
    assert.match(section, /`about`\s*equal to `\/docs\?day=/, 'the paragraph must say the fold is what keeps a /week bucket\'s about equal to /docs?day=\'s total')
    // the bug this fixes: claiming, in the same breath as the fold, that a kept day
    // unconditionally returns only docs whose BRT date is that day -- that cannot hold for
    // day=today once the fold is also true.
    assert.doesNotMatch(section, /only docs whose BRT date is that day are returned/)
    // a bad day must read as "the whole window comes back", not just "behaves as it did" buried
    // mid-sentence -- a caller sending garbage gets everything, not nothing.
    assert.match(section, /window back, not zero docs/)

    // V4 (PR #153 review): an earlier kept day is not exempt from the `days` window either --
    // the oldest admissible date can come back partial. The caveat belongs in the same paragraph
    // as the earlier-date rule, not buried among the invalid-value rules further down.
    const firstPara = section.slice(0, section.indexOf('A value that is missing'))
    assert.doesNotMatch(firstPara, /returns exactly the docs whose BRT date is that day/i, 'an earlier kept day must not be documented as an unconditional exact match')
    assert.match(firstPara, /intersects the[\s\S]{0,20}window/i, 'the day/days window intersection caveat must sit with the earlier-date rule')
    assert.match(firstPara, /oldest admissible date can[\s\S]{0,20}partial/i, 'the docs must say the oldest admissible date can come back partial')
  })

  it('/api/people/:id/rising (issue #151): about object and the raised default limit', () => {
    assert.match(docsText, /`about`/, 'the docs must name the about field')
    assert.match(docsText, /about\.recent|about\.baseline|recent.*baseline document totals|recent\/baseline/i, 'the docs must say about carries the person\'s own recent/baseline document totals')
    assert.match(docsText, /rising[\s\S]{0,400}\*\*40\*\*|\*\*40\*\*[\s\S]{0,400}rising/i, 'the docs must state rising\'s default limit is now 40')
  })

  it('/api/people (issue #212 AC6): tracked-people section documents party/office/uf/wikidata and the echo/no-echo split', () => {
    assert.match(docsText, /`party`,?\s*`office`(,|\s+and)\s*`uf`/, 'party/office/uf must be named together as the hand-edited metadata fields')
    assert.match(docsText, /`wikidata`/, 'wikidata must be documented as a seed.json field')
    assert.match(docsText, /never (be )?echoed/i, 'the docs must say wikidata is never echoed by any route')
    assert.match(docsText, /omit(ted|ting)[\s\S]{0,40}entirely/i, 'an absent field must be documented as omitted entirely')
    assert.match(docsText, /never\s*`?null`?|rather than sending it as `?null`?/i, 'the docs must say an absent field is never sent as null')
  })

  it('docs/sources.md (issue #212): tracked-people paragraph names party/office/uf/wikidata, says they are unpersisted and how they refresh', () => {
    const sources = docPageText.get('docs/sources.md') ?? ''
    assert.match(sources, /`party`,?\s*`office`(,|\s+and)\s*`uf`/, 'party/office/uf must be named together as the hand-edited metadata fields')
    assert.match(sources, /`wikidata`/, 'wikidata must be documented as a seed.json field')
    assert.match(sources, /feeds? no collector|none feeds a collector/i, 'the docs must say these fields feed no collector')
    assert.match(sources, /(none|not|nor)[\s\S]{0,60}persisted/i, 'the docs must say these fields are not persisted to the persons table')
    assert.match(sources, /need no `?pnpm reindex`?/i, 'the docs must say these fields need no pnpm reindex')
    assert.match(sources, /reloads `?seed\.json`?/i, 'the docs must say these fields reach /api/people when the server reloads seed.json')
    assert.match(sources, /redeploy/i, 'the docs must name a redeploy (or local restart) as the refresh path')
  })

  it('/api/people (issue #212 AC7): docs/api.md names party/office/uf as optional, additive fields on GET /api/people', () => {
    const api = docPageText.get('docs/api.md') ?? ''
    assert.match(api, /GET \/api\/people[\s\S]{0,300}`party`[\s\S]{0,100}`office`[\s\S]{0,100}`uf`/, 'docs/api.md must name party/office/uf as fields of GET /api/people')
    assert.match(api, /`wikidata`[\s\S]{0,100}never/, 'docs/api.md must say wikidata is never echoed')
  })
})

describe('PR #153 review: docs/operations.md cache-surface and staleness paragraphs', () => {
  it('the day cache-surface paragraph attributes the admissible-date figure to what keepDay parses, not to the page', () => {
    const ops = docPageText.get('docs/operations.md') ?? ''
    assert.doesNotMatch(ops, /the page itself only ever sends a date/, 'the page never sends a `day` parameter today; the figure belongs to keepDay, not to the page')
    assert.match(ops, /the admissible dates are at most `days \+ 1` of them/, 'the paragraph must attribute the day+1 figure to the admissible dates keepDay parses')
  })

  it('the week staleness window is stated as s-maxage + swr (30h), not s-maxage (6h) alone', () => {
    const ops = docPageText.get('docs/operations.md') ?? ''
    assert.doesNotMatch(ops, /roughly 06:00 in São Paulo the CDN/, 'the bare 6h-worst-case wording must be gone')
    assert.match(ops, /roughly 06:00 the next day in São Paulo/, 'the staleness window must land the next day, not the same day')
    assert.match(ops, /the full `s-maxage \+ swr`, 30h/, 'the paragraph must state the worst case is s-maxage + swr, 30h')
  })
})

describe('docs/operations.md states the dependency and size facts', () => {
  it('@huggingface/transformers is documented as required only by pnpm score and shipped as optional', () => {
    assert.match(docsText, /@huggingface\/transformers[\s\S]{0,80}required only by[\s\S]{0,20}pnpm score/, 'operations docs must say the package is required only by pnpm score')
    assert.match(docsText, /optionalDependencies/, 'operations docs must say it ships as an optional dependency')
  })

  it('the deployed /api function is documented as excluded from the import graph that reaches the model loader', () => {
    assert.match(docsText, /deployed[\s\S]{0,20}\/api[\s\S]{0,120}never reaches the model loader/i)
  })

  it('the measured before/after size of .vercel/output/functions/api/index.func is recorded, and after is smaller', () => {
    assert.match(docsText, /index\.func/, 'the docs must name the measured artifact')
    const bytes = [...docsText.matchAll(/before this split,[\s\S]{0,80}?was\s+([\d,]+)\s+bytes[\s\S]{0,200}?after,\s+it is\s+([\d,]+)\s+bytes/g)]
    assert.equal(bytes.length, 1, 'the docs must record one before/after size pair for index.func, in prose next to each other')
    const [, before, after] = bytes[0]
    assert.ok(Number(before.replace(/,/g, '')) > Number(after.replace(/,/g, '')), 'after must be recorded as smaller than before')
    assert.match(docsText, /onnxruntime-node/, 'the docs must name onnxruntime-node among what the before build carried')
    assert.match(docsText, /carries none of them/, 'the docs must state the after build carries none of the excluded packages')
  })
})

describe('docs facts', () => {
  it("kind's documented accepted values are exactly hashtag, org, phrase and word, never theme (issue #209)", () => {
    const m = /`kind`:\s*([^.\n]*)/.exec(docsText)
    assert.ok(m, 'no page documents what values `kind` accepts')
    const values = [...m![1].matchAll(/`(\w+)`/g)].map((x) => x[1]).sort()
    assert.deepEqual(values, ['hashtag', 'org', 'phrase', 'word'], "docs/api.md's kind line must list exactly hashtag, org, phrase and word")
  })

  it('pnpm purge themes is documented, and what it clears is documented alongside it', () => {
    const idx = docsText.indexOf('purge themes')
    assert.ok(idx > -1, 'no page documents `pnpm purge themes`')
    const around = docsText.slice(Math.max(0, idx - 200), idx + 400)
    assert.match(around, /extra_terms/, 'the purge themes docs must mention the extra_terms column it clears')
    assert.match(around, /kikori:q8/, 'the purge themes docs must mention the pre-revision kikori:q8-style testimony rows it clears')
  })

  it('the docs say public/index.html is gone, not a reachable legacy UI', () => {
    const idx = docsText.indexOf('index.html')
    assert.ok(idx > -1, 'no page mentions public/index.html at all')
    const around = docsText.slice(Math.max(0, idx - 80), idx + 160)
    assert.doesNotMatch(around, /reachable only by name/i, 'docs must stop describing index.html as reachable legacy UI')
    assert.match(around, /(gone|removed|deleted|no longer)/i, 'docs must say index.html is gone')
  })

  // AC10: org is sourced only from GDELT/gkg and never derived from text for any other source.
  it('the docs state org is sourced only from GDELT/gkg, never derived for any other source (issue #209 AC10)', () => {
    assert.match(docsText, /\borg\b[\s\S]{0,400}\bGDELT\b/, 'the docs must state org comes from GDELT, in prose near the word org')
    const idx = docsText.search(/\borg\b[\s\S]{0,400}\bGDELT\b/)
    const around = docsText.slice(Math.max(0, idx - 50), idx + 500)
    assert.match(around, /never|only|no other source/i, 'the docs must state org is exclusive to GDELT, not merely mentioned alongside it')
  })

  // AC7: the docs must state the model cache's revision-only keying and that the onnx scorer
  // itself, not only pnpm score, refuses to load unpinned (issue #201).
  it('the docs state the model cache keys by revision only when given, and that the onnx scorer itself refuses to load unpinned (issue #201 AC7)', () => {
    assert.match(docsText, /keys its file cache by revision only when/i, 'the docs must state the cache keys by revision only when one is given')
    assert.match(docsText, /onnx.{0,20}scorer itself refuses to load/i, 'the docs must state the onnx scorer itself, not only pnpm score, refuses to load unpinned')
  })

  it('CLAUDE.md no longer claims GDELT theme codes stay in the atlas or the API', () => {
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    assert.doesNotMatch(claude, /theme codes[^\n]*(stay|remain) in the API/i, 'CLAUDE.md must not describe theme codes staying in the API any more')
    assert.doesNotMatch(claude, /`kind`[^\n]*`theme`/, 'CLAUDE.md must not list theme as a kind value')
  })

  it('CLAUDE.md no longer describes public/index.html as reachable legacy UI', () => {
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    assert.doesNotMatch(claude, /index\.html[^\n]*reachable/i, 'CLAUDE.md must not describe index.html as reachable')
    assert.doesNotMatch(claude, /legacy UI, reachable only by name/i)
  })

  it("src/ui/api.ts's ATLAS_KINDS comment no longer claims theme codes stay in the API or show on atlas-legacy.html", () => {
    const apiTs = readFileSync(join(root, 'src/ui/api.ts'), 'utf8')
    assert.doesNotMatch(apiTs, /stay in the API/i)
    assert.doesNotMatch(apiTs, /atlas-legacy\.html/)
  })

  it('ATLAS_KINDS now requests org too (issue #209)', () => {
    const apiTs = readFileSync(join(root, 'src/ui/api.ts'), 'utf8')
    assert.match(apiTs, /ATLAS_KINDS = 'word,hashtag,phrase,org'/)
  })

})

// Issue #175: the test suite dropped test/atlas-modules-acceptance.test.ts (split into
// test/invariants.test.ts) and the "issue number in the title" labeling rule it used to
// follow. Both CLAUDE.md and docs/factory.md described that file and that rule by name, so
// a drift check here keeps the prose in step with the file layout it describes.
describe('CLAUDE.md and docs/factory.md describe the current test-file layout, not the deleted one', () => {
  it('CLAUDE.md no longer names the deleted test/atlas-modules-acceptance.test.ts', () => {
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    assert.doesNotMatch(claude, /atlas-modules-acceptance/, 'CLAUDE.md must not name the deleted test file')
  })

  it('docs/factory.md no longer names the deleted test/atlas-modules-acceptance.test.ts', () => {
    assert.doesNotMatch(docsText, /atlas-modules-acceptance/, 'docs/factory.md must not name the deleted test file')
  })

  it("CLAUDE.md's test/ bullet says a test asserts on output or behaviour, and scopes source-reading to test/invariants.test.ts", () => {
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    const bullet = /^-\s*`test\/`\s*node:test suites\.[^\n]*/m.exec(claude)?.[0]
    assert.ok(bullet, "CLAUDE.md must still carry a `test/` bullet")
    assert.match(bullet!, /asserts on output or behaviour/i, 'the test/ bullet must state that a test asserts on output or behaviour')
    assert.match(bullet!, /invariants\.test\.ts/, 'the test/ bullet must scope source-reading to a repo-wide invariant named in test/invariants.test.ts')
  })

  it("docs/factory.md no longer instructs putting the issue number in a test label's title", () => {
    assert.doesNotMatch(docsText, /with the issue number in its title/i, "docs/factory.md must not instruct an issue number in a test label's title any more")
  })

  it('docs/factory.md lists invariants.test.ts, not atlas-modules-acceptance.test.ts, among the cross-cutting test files', () => {
    assert.match(docsText, /\binvariants\b/, 'docs/factory.md must list invariants.test.ts among the cross-cutting files')
  })

  it('documents the jev-review shadow workflow', () => {
    assert.match(docsText, /jev-review/)
    assert.match(docsText, /OPENROUTER_API_KEY/)
    assert.match(docsText, /only comments and never blocks a merge/i)
    for (const id of ['conv-comment', 'conv-scoring-docs', 'conv-route-docs', 'conv-class', 'conv-issue-test', 'conv-commits'])
      assert.ok(docsText.includes(id), `the docs must list the ${id} check`)
  })
})

describe('the term dictionary is documented (issue #252)', () => {
  it('states the vocabulary table, the term_id key, the in-place conversion and the reindex rebuild (AC18)', () => {
    assert.match(docsText, /\bvocabulary\b/i, 'the vocabulary is named')
    assert.match(docsText, /`terms\b[^`]*`/, 'the `terms` table is named')
    assert.match(docsText, /`\(term, kind\)`/, 'the vocabulary holds (term, kind) pairs')
    assert.match(docsText, /`doc_terms\b[^`]*term_id[^`]*`|`term_id`/, 'doc_terms is keyed by term_id')
    assert.match(docsText, /pnpm migrate`[^.\n]*(legacy|in place|converts)|(legacy|in place|converts)[^.\n]*`pnpm migrate/i, 'migrate converts a legacy doc_terms')
    assert.match(docsText, /(no|without a|not need a) reindex|needs no reindex/i, 'the conversion needs no reindex')
    assert.match(docsText, /`pnpm reindex`[^.\n]*`terms`|`terms`[^.\n]*`pnpm reindex`|reindex[^.\n]*vocabulary/i, 'reindex rebuilds the vocabulary')
  })

  it('tells production to run pnpm migrate right after the deploy, with the scheduled ingest paused (AC18)', () => {
    assert.match(docsText, /ingest\.yml/)
    assert.match(docsText, /disable[^.\n]*ingest\.yml[^.\n]*deploy[^.\n]*pnpm migrate[^.\n]*re-?enable[^.\n]*ingest\.yml/i)
  })
})

describe('the warm store is documented', () => {
  it('states that warm recortes come from a store outside Postgres and fall back to live on a miss', () => {
    assert.match(docsText, /store outside Postgres/i)
    assert.match(docsText, /fall back to (the )?live/i)
  })

  it('names the command, both variables and both headers', () => {
    for (const name of ['pnpm materialize', 'WARM_STORE_URL', 'BLOB_READ_WRITE_TOKEN', 'x-warm-store', 'x-warm-store-only'])
      assert.ok(docsText.includes(name), `the docs must name ${name}`)
  })

  it('says a stored recorte\'s links come from the build\'s own edges and its freshness key is the scope\'s built_at', () => {
    assert.match(docsText, /links[^.\n]*(come from|sliced from)[^.\n]*build's own[^.\n]*edges/i)
    assert.match(docsText, /freshness key[^.\n]*`?(graph_scopes\.)?built_at`?/i)
  })

  it('tells a manual pnpm score to be followed by pnpm materialize', () => {
    assert.match(docsText, /pnpm score[^.\n]*pnpm materialize|pnpm materialize[^.\n]*after[^.\n]*pnpm score/i)
  })

  it('no longer says the default recorte\'s links always run live', () => {
    assert.doesNotMatch(docsText, /`\/graph`'s links always run live/)
    assert.match(docsText, /links run live off the warm set/)
  })
})
