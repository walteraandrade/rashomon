import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { docsFor, graphFor, sourcesFor, type DocsQuery, type GraphQuery } from '../src/graph.js'
import { parseSourceList } from '../src/query.js'
import { persons, seed } from './fixture.js'

// Independent verification of issue #8's numbered acceptance criteria, written against
// the spec rather than against test/graph.test.ts or test/docs.test.ts. Counts below are
// hand-recomputed from test/fixture.ts, not copied from the builder's assertions, and the
// query shapes (limit/min) deliberately differ from graph.test.ts's `base` so a passing
// check here exercises real behaviour.
const [lula] = persons
const graphBase: GraphQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 25, min: 1, sort: 'pmi' }
const docsBase: DocsQuery = { term: '', kind: 'all', days: 30, source: 'all', domain: 'all', lean: 'all', limit: 20, offset: 0 }

describe('press vs network acceptance criteria (issue #8)', () => {
  before(seed)

  it('AC1: a comma-separated source list scopes graphFor/sourcesFor/docsFor to exactly those docs', async () => {
    // within the default 30-day window, gnews|rss|gkg docs about lula are /1, /6 (gnews),
    // /7 (rss) and /38 (gkg) -> 4 about-lula docs; the in-scope-but-not-about-lula docs in
    // that source set are /3 (gnews, tarcisio), /4 (rss, nobody) and /36 (rss, tarcisio),
    // for 7 docs total in scope.
    const g = await graphFor(lula, { ...graphBase, source: 'gnews,rss,gkg' })
    assert.equal(g.stats.docs, 7)
    assert.equal(g.stats.about, 4)

    const rows = await sourcesFor(lula, { ...graphBase, source: 'gnews,rss,gkg' })
    assert.equal(
      rows.reduce((sum, r) => sum + r.docs, 0),
      4,
    )
    assert.ok(rows.every((r) => r.source === 'gnews' || r.source === 'rss' || r.source === 'gkg'))

    const { total, docs } = await docsFor(lula, { ...docsBase, source: 'gnews,rss,gkg' })
    assert.equal(total, 4)
    assert.ok(docs.every((d) => d.source === 'gnews' || d.source === 'rss' || d.source === 'gkg'))
  })

  it('AC2: an unknown token is dropped silently, same result as the valid token alone', async () => {
    // gnews-only about-lula docs in the window are /1 and /6.
    const withBogus = await graphFor(lula, { ...graphBase, source: 'gnews,bogus' })
    const gnewsOnly = await graphFor(lula, { ...graphBase, source: 'gnews' })
    assert.equal(gnewsOnly.stats.about, 2)
    assert.deepEqual(withBogus, gnewsOnly)

    const { total: totalBogus } = await docsFor(lula, { ...docsBase, source: 'gnews,bogus' })
    const { total: totalGnews } = await docsFor(lula, { ...docsBase, source: 'gnews' })
    assert.equal(totalBogus, totalGnews)
  })

  it('AC3: when every token is invalid, parseSourceList normalizes to "all" and behaviour matches "all"', async () => {
    const normalized = parseSourceList('bogus1,bogus2')
    assert.equal(normalized, 'all')
    const viaBogus = await graphFor(lula, { ...graphBase, source: normalized })
    const viaAll = await graphFor(lula, { ...graphBase, source: 'all' })
    assert.deepEqual(viaBogus, viaAll)
  })

  it('AC4: a missing or empty source normalizes to "all" and behaviour matches "all"', async () => {
    assert.equal(parseSourceList(undefined), 'all')
    assert.equal(parseSourceList(''), 'all')
    const viaEmpty = await graphFor(lula, { ...graphBase, source: parseSourceList('') })
    const viaAll = await graphFor(lula, { ...graphBase, source: 'all' })
    assert.deepEqual(viaEmpty, viaAll)
  })

  it('AC5: a single valid token behaves exactly as it did before this change', async () => {
    // doc /2 (bluesky) is the only bluesky doc about lula in the window.
    const { total, docs } = await docsFor(lula, { ...docsBase, source: 'bluesky' })
    assert.equal(total, 1)
    assert.equal(docs[0]?.uri, 'at://did:plc:x/post/2')
  })

  it('AC6: parseSourceList falls back to "all", keeps a lone token, and joins+dedupes valid tokens', () => {
    assert.equal(parseSourceList(undefined), 'all')
    assert.equal(parseSourceList(''), 'all')
    assert.equal(parseSourceList('all'), 'all')
    assert.equal(parseSourceList('bogus'), 'all')
    assert.equal(parseSourceList('gnews'), 'gnews')
    assert.equal(parseSourceList('gnews,bogus'), 'gnews')
    assert.equal(parseSourceList('gnews,rss'), 'gnews,rss')
    assert.equal(parseSourceList('gnews,rss,gnews'), 'gnews,rss')
  })

  it('AC6: matches the enum case-sensitively and trims whitespace around each token', () => {
    assert.equal(parseSourceList('GNEWS'), 'all', 'uppercase must not match the lowercase enum')
    assert.equal(parseSourceList('gnews, rss'), 'gnews,rss', '" rss" with a leading space still matches "rss" once trimmed')
  })

  it('AC7: mixing gkg with non-GDELT sources gives non-null tone only to terms carried by the gkg doc', async () => {
    const g = await graphFor(lula, { ...graphBase, source: 'gnews,rss,gkg', kind: 'word' })
    // "assina" only appears in doc /38 (gkg, tone 0.6); "reforma" appears only in
    // gnews/rss docs /1, /6, /7, none of which carry a tone.
    assert.equal(g.nodes.find((n) => n.term === 'assina')?.tone, 0.6)
    assert.equal(g.nodes.find((n) => n.term === 'reforma')?.tone, null)
  })

  it('AC7: excluding gkg from the list never surfaces a tone for the same term', async () => {
    const g = await graphFor(lula, { ...graphBase, source: 'gnews,rss', kind: 'word' })
    assert.equal(g.nodes.find((n) => n.term === 'reforma')?.tone, null)
    assert.equal(g.nodes.find((n) => n.term === 'assina'), undefined, 'assina only exists in the gkg doc')
  })
})
