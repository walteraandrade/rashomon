import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, after, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { nameTokens } from '../src/extract.js'
import {
  compareFor,
  docsFor,
  docsWhereSql,
  graphFor,
  queries,
  risingFor,
  sourcesFor,
  statements,
  testimonyFor,
  timelineFor,
  toneFor,
  type CompareQuery,
  type DocsQuery,
  type GraphQuery,
  type RisingQuery,
  type TestimonyQuery,
  type TimelineQuery,
  type ToneQuery,
} from '../src/graph.js'
import { resolveScope } from '../src/outlets.js'
import { KINDS, parseQuery, parseSourceList } from '../src/query.js'
import { inTransaction, insertDoc, upsertPersons } from '../src/store.js'
import type { Person, Source } from '../src/types.js'
import { futureDoc, insertTestimony, persons, reseed, seed } from './fixture.js'
import './close.js'

// Every statement in src/graph.ts, one section per route, against the shared fixture. A
// section that writes past the fixture registers `after(reseed)`, since the file shares one
// in-memory database and the pinned literals below assume the fixture and nothing else.

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

const [lula, tarcisio, bolsonaro] = persons
const nobody: Person = { id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }
const pmi = (cPt: number, cT: number, n: number, np: number) => Math.round(Math.log2((cPt * n) / (np * cT)) * 100) / 100

const graphBase: GraphQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 40, min: 1, sort: 'count' }
const docsBase: DocsQuery = { term: '', kind: 'all', days: 30, source: 'all', domain: 'all', lean: 'all', limit: 50, offset: 0 }
const risingBase: RisingQuery = { days: 7, baseline: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 20, min: 1 }
const timelineBase: TimelineQuery = { term: '', kind: 'all', days: 30, source: 'all', domain: 'all', lean: 'all', bucket: 'week' }
const toneBase: ToneQuery = { days: 30, min: 3 }
const testimonyBase: TestimonyQuery = { days: 30, source: 'all', method: 'stub', min: 3 }
const compareBase: CompareQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 40 }

const node = (g: Awaited<ReturnType<typeof graphFor>>, id: string) => g.nodes.find((n) => n.id === id)
const sumOf = (rows: { count: number }[]) => rows.reduce((a, r) => a + r.count, 0)

describe('graphFor', () => {
  before(seed)

  it('counts docs in the window and docs about the person', async () => {
    const g = await graphFor(lula, graphBase)
    // days:30 also picks up docs /30-/36 (tarcisio gdelt/rss tone fixtures for issue #5; doc /37
    // sits at day 35, just outside this window) and doc /38 (gkg, about lula, issue #8's
    // press-vs-network fixture), widening both the person-agnostic scope (docs 13 -> 14) and about (4 -> 5)
    assert.equal(g.stats.docs, 14)
    assert.equal(g.stats.about, 5)
  })

  it('widens with the window', async () => {
    // 365 days also picks up docs /17-/19 (estabilidade fiscal, day31/35/50), added for risingFor's tests
    const g = await graphFor(lula, { ...graphBase, days: 365 })
    assert.equal(g.stats.docs, 19)
    assert.equal(g.stats.about, 9)
  })

  it('never lists the person name as a term', async () => {
    const g = await graphFor(lula, graphBase)
    assert.ok(!g.nodes.some((n) => n.term === 'lula'))
  })

  it('computes pmi as log2 lift against the docs about tracked people', async () => {
    const g = await graphFor(lula, graphBase)
    // pmi's n is the tracked universe, not stats.docs: of the 14 docs in the window, doc /4
    // ("Congresso avança na pauta econômica") names nobody tracked, so it carries no terms and
    // cannot contribute to the denominator either -> n is 13
    assert.equal(node(g, 'word:reforma')?.pmi, pmi(3, 3, 13, 5))
    assert.equal(node(g, 'word:eleicao')?.pmi, pmi(1, 1, 13, 5))
    assert.equal(node(g, 'word:congresso'), undefined)
  })

  it('carries hashtags as their own kind and filters by kind', async () => {
    const all = await graphFor(lula, graphBase)
    assert.equal(node(all, 'hashtag:reforma')?.count, 1)
    const only = await graphFor(lula, { ...graphBase, kind: 'hashtag' })
    assert.ok(only.nodes.length > 0)
    assert.ok(only.nodes.every((n) => n.kind === 'hashtag'))
  })

  it('averages GDELT tone per term and leaves it null otherwise', async () => {
    const g = await graphFor(tarcisio, graphBase)
    assert.equal(node(g, 'word:rodovia')?.tone, -1.5)
    assert.equal(node(g, 'word:eleicao')?.tone, null)
  })

  it('filters by source and by domain', async () => {
    const bs = await graphFor(lula, { ...graphBase, source: 'bluesky' })
    assert.equal(bs.stats.about, 1)
    const g1 = await graphFor(lula, { ...graphBase, domain: 'g1.globo.com' })
    assert.equal(g1.stats.about, 1)
    assert.equal(g1.stats.docs, 1)
  })

  it('honours min and limit', async () => {
    const g = await graphFor(lula, { ...graphBase, min: 2 })
    assert.deepEqual(g.nodes.map((n) => n.term).sort(), ['reforma', 'tributaria'])
    const one = await graphFor(lula, { ...graphBase, limit: 1 })
    assert.equal(one.nodes.length, 1)
  })

  it('links every term to the person and co-occurring terms to each other', async () => {
    const g = await graphFor(lula, graphBase)
    const spokes = g.links.filter((l) => l.source === 'person:lula')
    assert.equal(spokes.length, g.nodes.length)
    const pair = g.links.find((l) => l.source === 'word:reforma' && l.target === 'word:tributaria')
    assert.equal(pair?.count, 2)
    assert.ok(!g.links.some((l) => l.source === 'word:disputam'), 'pairs seen in a single doc are not linked')
  })

  it('returns an empty graph for a person without docs', async () => {
    const g = await graphFor(nobody, graphBase)
    assert.equal(g.stats.about, 0)
    assert.deepEqual(g.nodes, [])
  })

  it('keeps the whole response shape', async () => {
    const g = await graphFor(lula, graphBase)
    assert.deepEqual(Object.keys(g).sort(), ['links', 'nodes', 'outlets', 'person', 'signature', 'stats'])
    assert.deepEqual(Object.keys(g.stats).sort(), ['about', 'docs'])
    for (const n of g.nodes) assert.deepEqual(Object.keys(n).sort(), ['count', 'id', 'kind', 'pmi', 'term', 'tone'])
    for (const row of g.signature) assert.deepEqual(Object.keys(row).sort(), ['count', 'kind', 'pmi', 'term'])
    for (const link of g.links) assert.deepEqual(Object.keys(link).sort(), ['count', 'source', 'target'])
  })

  it('returns numbers and nulls, never json strings', async () => {
    const g = await graphFor(tarcisio, graphBase)
    const rodovia = node(g, 'word:rodovia')
    assert.equal(typeof rodovia?.count, 'number')
    assert.equal(typeof rodovia?.pmi, 'number')
    assert.equal(rodovia?.tone, -1.5)
    assert.equal(node(g, 'word:eleicao')?.tone, null)
  })

  // Issue #108: 'theme' left the recognized kind set, so kind=theme must behave like any other
  // unrecognized token on this route: filtered to nothing, not a known-but-empty subset.
  it('returns zero nodes for kind=theme, exactly as for kind=bogus, though kind=all has nodes', async () => {
    const all = await graphFor(lula, graphBase)
    assert.ok(all.nodes.length > 0, 'sanity: this window must have nodes for the comparison to mean anything')
    const theme = await graphFor(lula, { ...graphBase, kind: 'theme' })
    const bogus = await graphFor(lula, { ...graphBase, kind: 'bogus' })
    assert.deepEqual(theme.nodes, [])
    assert.deepEqual(bogus.nodes, [])
  })
})

describe('signature (issue #6)', () => {
  before(seed)

  it('AC1: default 30-day scope for lula yields exactly the reforma signature, at the count floor of max(3, 5% of about)', async () => {
    const g = await graphFor(lula, graphBase)
    // issue #6's spec-pinned 0.58 became 1.49 when docs /36 and /38 widened n.total to 14 and np
    // to 5; issue #52 then removed doc /4 (names nobody tracked, so it carries no terms) from
    // pmi's universe, leaving n = 13 and pmi = log2(3*13/(5*3)) = 1.38.
    assert.deepEqual(g.signature, [{ term: 'reforma', kind: 'word', count: 3, pmi: pmi(3, 3, 13, 5) }])
    assert.equal(g.signature[0].pmi, 1.38)
  })

  it('AC2: signature never contains one of the person own name tokens', async () => {
    const excluded = new Set(nameTokens(lula))
    const g = await graphFor(lula, { ...graphBase, days: 2000 })
    assert.ok(g.signature.length > 0, 'sanity: this scope should surface signature terms')
    for (const row of g.signature) assert.ok(!excluded.has(row.term), `${row.term} is a name token and must be excluded`)
  })

  it('AC3: signature is unaffected by kind, min, limit and sort', async () => {
    const a = await graphFor(lula, graphBase)
    const b = await graphFor(lula, { ...graphBase, kind: 'hashtag', min: 10, limit: 1, sort: 'pmi' })
    const c = await graphFor(lula, { ...graphBase, kind: 'phrase', min: 1, limit: 200, sort: 'pmi' })
    assert.ok(a.signature.length > 0, 'sanity: variance check is only meaningful with a non-empty signature')
    assert.deepEqual(b.signature, a.signature)
    assert.deepEqual(c.signature, a.signature)
  })

  it('AC4: signature never exceeds 5 entries and drops extra ties instead of padding', async () => {
    const g = await graphFor(lula, { ...graphBase, days: 2000 })
    assert.equal(g.signature.length, 5, 'exactly 5 of the equally-qualifying terms must survive the fixed cap')
    const terms = g.signature.map((s) => s.term)
    assert.equal(new Set(terms).size, terms.length, 'no duplicate/padded rows')
    // docs /17-/19 add "estabilidade"/"fiscal" (3 mentions each) and, incidentally, a 3rd "defende"
    // (docs /6, /15 and /17 all use it), widening the tie set from 6 to 9 candidate terms; 28 docs
    // sit in this window, of which doc /4 names nobody tracked and is outside pmi's universe, so
    // n is 27; np is 18
    const expectedPmi = pmi(3, 3, 27, 18)
    assert.deepEqual(g.signature, [
      { term: 'defende', kind: 'word', count: 3, pmi: expectedPmi },
      { term: 'desemprego', kind: 'word', count: 3, pmi: expectedPmi },
      { term: 'educacao', kind: 'word', count: 3, pmi: expectedPmi },
      { term: 'estabilidade', kind: 'word', count: 3, pmi: expectedPmi },
      { term: 'fiscal', kind: 'word', count: 3, pmi: expectedPmi },
    ])
    assert.ok(!terms.includes('seguranca'), 'a lower-alphabet equally-qualifying term must be dropped by the fixed limit 5, not silently kept')
  })

  it('AC5: signature is empty for a person with stats.about === 0', async () => {
    const g = await graphFor(nobody, graphBase)
    assert.equal(g.stats.about, 0)
    assert.deepEqual(g.signature, [])
  })

  it('AC6: signature orders by pmi desc, ties broken by term ascending', async () => {
    const g = await graphFor(lula, { ...graphBase, days: 1000 })
    // docs /17-/19 add "estabilidade"/"fiscal" (3 mentions each, about-lula only), tying with the others;
    // 25 docs sit in this window, of which doc /4 names nobody tracked and is outside pmi's
    // universe, so n is 24; np is 15
    const tie = pmi(3, 3, 24, 15)
    assert.deepEqual(g.signature, [
      { term: 'desemprego', kind: 'word', count: 3, pmi: tie },
      { term: 'estabilidade', kind: 'word', count: 3, pmi: tie },
      { term: 'fiscal', kind: 'word', count: 3, pmi: tie },
      { term: 'inflacao', kind: 'word', count: 3, pmi: tie },
      { term: 'reforma', kind: 'word', count: 3, pmi: tie },
    ])
  })

  it('signature rows expose exactly term, kind, count and pmi, never tone', async () => {
    const g = await graphFor(lula, graphBase)
    assert.ok(g.signature.length > 0)
    for (const row of g.signature) assert.deepEqual(Object.keys(row).sort(), ['count', 'kind', 'pmi', 'term'])
  })
})

describe('multi-source filtering (issue #8)', () => {
  before(seed)

  it('AC1: a comma-separated list counts only docs whose source is in the list', async () => {
    const g = await graphFor(lula, { ...graphBase, source: 'gnews,rss,gkg' })
    // hand-counted from the fixture: within the default 30-day window, gnews has docs /1,/6
    // (about lula) and /3 (not about lula); rss has /4 (not about lula), /7, /36 (about tarcisio);
    // gkg has /38 (about lula) -> 7 docs in scope, 4 about lula (/1, /6, /7, /38)
    assert.equal(g.stats.docs, 7)
    assert.equal(g.stats.about, 4)
  })

  it('AC1: sourcesFor and docsFor agree with the same hand-counted scope', async () => {
    const rows = await sourcesFor(lula, { ...graphBase, source: 'gnews,rss,gkg' })
    assert.equal(rows.reduce((acc, r) => acc + r.docs, 0), 4)
    assert.ok(rows.every((r) => r.source === 'gnews' || r.source === 'rss' || r.source === 'gkg'))
    const { total, docs: found } = await docsFor(lula, { ...docsBase, source: 'gnews,rss,gkg' })
    assert.equal(total, 4)
    assert.ok(found.every((d) => d.source === 'gnews' || d.source === 'rss' || d.source === 'gkg'))
  })

  it('AC2: an unknown token is silently dropped, same result as the valid token alone', async () => {
    const withBogus = await graphFor(lula, { ...graphBase, source: 'gnews,bogus' })
    const gnewsOnly = await graphFor(lula, { ...graphBase, source: 'gnews' })
    assert.equal(gnewsOnly.stats.about, 2)
    assert.deepEqual(withBogus, gnewsOnly)
    const { total: totalBogus } = await docsFor(lula, { ...docsBase, source: 'gnews,bogus' })
    const { total: totalGnews } = await docsFor(lula, { ...docsBase, source: 'gnews' })
    assert.equal(totalBogus, totalGnews)
  })

  it('AC3: every token invalid normalizes (via parseSourceList) to "all"', async () => {
    const normalized = await graphFor(lula, { ...graphBase, source: parseSourceList('bogus1,bogus2') })
    const all = await graphFor(lula, { ...graphBase, source: 'all' })
    assert.deepEqual(normalized, all)
  })

  it('AC4: an empty source normalizes (via parseSourceList) to "all"', async () => {
    const normalized = await graphFor(lula, { ...graphBase, source: parseSourceList('') })
    const all = await graphFor(lula, { ...graphBase, source: 'all' })
    assert.deepEqual(normalized, all)
  })

  it('AC5: a single valid token behaves exactly like before this change', async () => {
    const bs = await graphFor(lula, { ...graphBase, source: 'bluesky' })
    assert.equal(bs.stats.about, 1)
    // doc /2 (bluesky) is the only bluesky doc about lula in the window.
    const { total, docs: found } = await docsFor(lula, { ...docsBase, source: 'bluesky' })
    assert.equal(total, 1)
    assert.equal(found[0]?.uri, 'at://did:plc:x/post/2')
  })

  it('AC7: mixing a GDELT and a non-GDELT source yields tone only for terms carried by the gkg doc', async () => {
    const g = await graphFor(lula, { ...graphBase, source: 'gnews,rss,gkg' })
    // "parceria" and "assina" only appear in doc /38 (gkg, tone 0.6); "reforma" only appears in gnews/rss docs
    assert.equal(g.nodes.find((n) => n.term === 'parceria')?.tone, 0.6)
    assert.equal(g.nodes.find((n) => n.term === 'assina')?.tone, 0.6)
    assert.equal(g.nodes.find((n) => n.term === 'reforma')?.tone, null)
  })

  it('AC7: source without gkg never surfaces a tone', async () => {
    const g = await graphFor(lula, { ...graphBase, source: 'gnews,rss' })
    assert.equal(g.nodes.find((n) => n.term === 'reforma')?.tone, null)
    assert.equal(g.nodes.find((n) => n.term === 'assina'), undefined, 'assina only exists in the gkg doc')
  })
})

describe('senado source (issue #25)', () => {
  before(seed)
  after(reseed)

  it('AC8: source=senado for a person with no senado docs returns an empty, stats.docs===0 graph', async () => {
    // stats.docs is the person-agnostic scope count, so the window must stay narrower than the
    // fixture's senado doc (dated ~3200 days ago) or scope itself would stop being empty
    const g = await graphFor(tarcisio, { ...graphBase, source: 'senado' })
    assert.deepEqual(g.nodes, [])
    assert.deepEqual(g.links, [])
    assert.deepEqual(g.signature, [])
    assert.equal(g.stats.docs, 0)
    assert.equal(g.stats.about, 0)
  })

  it("surfaces a senado doc's terms for the tagged senator at a wide-enough window", async () => {
    const alcolumbre = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre', 'Davi Alcolumbre'] }
    await upsertPersons([alcolumbre])
    const uri = 'https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/222222'
    await insertDoc(
      { source: 'senado', uri, text: 'Davi Alcolumbre: pronunciamento sobre soberania nacional e infraestrutura portuária', publishedAt: daysAgo(3200), domain: 'senado.leg.br' },
      [...persons, alcolumbre],
    )
    const g = await graphFor(alcolumbre, { ...graphBase, days: 3300, source: 'senado' })
    assert.equal(g.stats.about, 1)
    assert.ok(g.nodes.some((n) => n.term === 'soberania'))
    assert.equal(g.nodes.find((n) => n.term === 'soberania')?.tone, null)
    const { docs: found } = await docsFor(alcolumbre, { ...docsBase, days: 3300, source: 'senado' })
    assert.ok(found.some((d) => d.uri === uri), 'the senado doc must surface via docsFor too')
  })
})

describe('sourcesFor', () => {
  before(seed)

  it('lists outlets that mention the person with doc counts and tone', async () => {
    const rows = await sourcesFor(tarcisio, graphBase)
    const folha = rows.find((r) => r.domain === 'folha.uol.com.br')
    assert.equal(folha?.docs, 1)
    assert.equal(folha?.tone, -1.5)
    assert.equal(folha?.tone_n, 1)
    const bsky = rows.find((r) => r.source === 'bluesky')
    assert.equal(bsky?.domain, 'ana.bsky.social')
    assert.equal(bsky?.tone, null)
  })
})

// Widest window that reaches doc /41 (cartacapital.com.br, left, day 2200) without
// touching anything past it (senado doc /40 sits at day 3200).
const wide = 2210
const wideBase: GraphQuery = { ...graphBase, days: wide }
const wideDocs: DocsQuery = { ...docsBase, days: wide }

describe('lean filtering (issue #26)', () => {
  before(seed)

  it('AC3: domain=cartacapital.com.br,poder360.com.br behaves as an OR across both domains', async () => {
    const { total, docs: found } = await docsFor(bolsonaro, { ...wideDocs, domain: 'cartacapital.com.br,poder360.com.br' })
    assert.equal(total, 2)
    assert.deepEqual(found.map((d) => d.domain).sort(), ['cartacapital.com.br', 'poder360.com.br'])
  })

  it('AC5: lean=right scopes to outlets.json right-labeled domains and excludes an unlabeled domain', async () => {
    const g = await graphFor(bolsonaro, { ...wideBase, lean: 'right' })
    assert.equal(g.stats.docs, 1)
    assert.equal(g.stats.about, 1)
    const { total, docs: found } = await docsFor(bolsonaro, { ...wideDocs, lean: 'right' })
    assert.equal(total, 1)
    assert.equal(found[0].domain, 'oantagonista.com.br')
    // doc /20/22/23/24 (example.org, absent from outlets.json) never surface under any lean
    assert.ok(!found.some((d) => d.domain === 'example.org'))
  })

  it('lean=left,right unions both labels and still excludes center and unlabeled', async () => {
    const { total, docs: found } = await docsFor(bolsonaro, { ...wideDocs, lean: 'left,right' })
    assert.equal(total, 2)
    assert.deepEqual(found.map((d) => d.domain).sort(), ['cartacapital.com.br', 'oantagonista.com.br'])
    assert.ok(!found.some((d) => d.domain === 'poder360.com.br'), 'poder360.com.br is center, must be excluded')
    assert.ok(!found.some((d) => d.domain === 'example.org'), 'example.org is unlabeled, must be excluded')
  })

  it('AC12: a domain absent from outlets.json, requested via lean alone, is excluded rather than defaulted to center', async () => {
    // only poder360.com.br (doc /37, day 35) is labeled center; example.org must never be swept in
    const { total } = await docsFor(bolsonaro, { ...wideDocs, lean: 'center' })
    assert.equal(total, 1)
  })

  it('AC6: domain and lean intersect; an empty intersection returns zero docs, not all', async () => {
    // oantagonista.com.br satisfies domain but is labeled right, not left -> excluded
    const excluded = await docsFor(bolsonaro, { ...wideDocs, domain: 'oantagonista.com.br', lean: 'left' })
    assert.deepEqual(excluded, { total: 0, docs: [], outlets: [] })
    const { total, docs: found } = await docsFor(bolsonaro, { ...wideDocs, domain: 'example.org', lean: 'right' })
    assert.deepEqual({ total, docs: found }, { total: 0, docs: [] })
    const g = await graphFor(bolsonaro, { ...wideBase, domain: 'example.org', lean: 'right' })
    assert.equal(g.stats.docs, 0)
    assert.equal(g.stats.about, 0)
    assert.deepEqual(g.nodes, [])
    assert.deepEqual(g.links, [])
  })

  it('AC8: outlets is empty when lean is unset and populated with basis when lean narrows the scope', async () => {
    const plain = await graphFor(bolsonaro, wideBase)
    assert.deepEqual(plain.outlets, [])
    assert.deepEqual((await docsFor(bolsonaro, wideDocs)).outlets, [])
    assert.deepEqual((await risingFor(bolsonaro, { ...risingBase, days: wide, baseline: 1 })).outlets, [])

    // lean=right resolves to every outlets.json domain labeled right, not only the ones
    // that happen to have a doc in this window's corpus (crusoe.com.br has none here).
    const scoped = await graphFor(bolsonaro, { ...wideBase, lean: 'right' })
    const sorted = (o: { domain: string }[]) => o.slice().sort((a, b) => a.domain.localeCompare(b.domain))
    assert.deepEqual(sorted(scoped.outlets), [
      { domain: 'crusoe.com.br', lean: 'right', basis: 'third_party_consensus' },
      { domain: 'oantagonista.com.br', lean: 'right', basis: 'third_party_consensus' },
    ])
    const leanDocs = await docsFor(bolsonaro, { ...wideDocs, lean: 'right' })
    assert.deepEqual(sorted(leanDocs.outlets), sorted(scoped.outlets))
  })

  it('AC7/AC9: sourcesFor filters by domain (regression) and annotates every row with lean/basis', async () => {
    const unfiltered = await sourcesFor(bolsonaro, wideBase)
    const filtered = await sourcesFor(bolsonaro, { ...wideBase, domain: 'oantagonista.com.br' })
    assert.ok(unfiltered.length > filtered.length, 'domain filter must actually shrink the row set')
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].domain, 'oantagonista.com.br')
    assert.equal(filtered[0].lean, 'right')
    assert.equal(filtered[0].basis, 'third_party_consensus')

    const exampleRow = unfiltered.find((r) => r.domain === 'example.org')
    assert.equal(exampleRow?.lean, null)
    assert.equal(exampleRow?.basis, null)
    // lean/basis present even though this call never passed q.lean
    assert.ok(unfiltered.every((r) => 'lean' in r && 'basis' in r))
  })

  // risingSql is the one place the domain clause is duplicated, in recent_scope and again in
  // baseline_scope. Every other lean test only exercises the recent half; this one watches the
  // baseline half move. days:2250/baseline:100 puts "golpe" in the recent window via doc 21
  // (oantagonista.com.br, right) and in the baseline window via doc 42 (cartacapital.com.br,
  // left), so lean=right must drop the baseline hit while keeping the recent one.
  it('risingFor narrows count_baseline by lean, not only count_recent', async () => {
    const q: RisingQuery = { ...risingBase, days: 2250, baseline: 100, limit: 100 }

    const all = await risingFor(bolsonaro, q)
    const golpeAll = all.terms.find((t) => t.term === 'golpe')
    assert.equal(golpeAll?.count_baseline, 0.01, 'doc 42 must reach the baseline window when lean is unset')

    const right = await risingFor(bolsonaro, { ...q, lean: 'right' })
    const golpeRight = right.terms.find((t) => t.term === 'golpe')
    assert.ok(golpeRight, 'doc 21 keeps golpe in the recent window under lean=right')
    assert.equal(golpeRight?.count_baseline, 0, 'doc 42 is left-labeled, so lean=right must empty the baseline half')
  })

  it('AC10: timelineFor stays a bare {bucket_start,count}[] array and still narrows by lean', async () => {
    const q: TimelineQuery = { ...timelineBase, days: wide, lean: 'right' }
    const rows = await timelineFor(bolsonaro, q)
    assert.ok(Array.isArray(rows))
    assert.ok(!('outlets' in rows))
    for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['bucket_start', 'count'])
    assert.equal(sumOf(rows), 1)

    const allLean = await timelineFor(bolsonaro, { ...q, lean: 'all' })
    assert.equal(sumOf(allLean), 7)
  })
})

describe('docsFor', () => {
  before(seed)

  it('AC1,AC2: returns every doc about the person in the window, newest first, ties broken by id desc, when no term is given', async () => {
    const { total, docs: found } = await docsFor(lula, docsBase)
    // widened by doc /38 (gkg, day1, issue #8's press-vs-network fixture)
    assert.equal(total, 5)
    assert.equal(found.length, 5)
    for (let i = 1; i < found.length; i++) {
      const prevTime = new Date(found[i - 1].published_at).getTime()
      const curTime = new Date(found[i].published_at).getTime()
      assert.ok(prevTime > curTime || (prevTime === curTime && found[i - 1].id > found[i].id))
    }
  })

  it('AC3: filters by term and kind, matching normalized tokens exactly', async () => {
    const { total, docs: found } = await docsFor(lula, { ...docsBase, term: 'reforma', kind: 'word' })
    assert.equal(total, 3)
    assert.equal(found.length, 3)
  })

  it('AC4: falls back to matching every kind when kind is unknown', async () => {
    const { total } = await docsFor(lula, { ...docsBase, term: 'reforma', kind: 'bogus' })
    assert.equal(total, 3)
  })

  // Issue #108: 'theme' left the recognized kind set, so it must fall back exactly like any
  // other unrecognized token, not like a known-but-empty subset.
  it('AC4: kind=theme falls back to matching every kind, same as kind=bogus', async () => {
    const { total } = await docsFor(lula, { ...docsBase, term: 'reforma', kind: 'theme' })
    assert.equal(total, 3)
  })

  it('AC5: widens with the window', async () => {
    // 365 days also picks up docs /17-/19 (estabilidade fiscal, day31/35/50), added for risingFor's tests
    const { total, docs: found } = await docsFor(lula, { ...docsBase, days: 365 })
    assert.equal(total, 9)
    assert.equal(found.length, 9)
  })

  it('AC6: filters by source', async () => {
    const { total } = await docsFor(lula, { ...docsBase, source: 'bluesky' })
    assert.equal(total, 1)
  })

  it('AC7: filters by domain', async () => {
    const { total } = await docsFor(lula, { ...docsBase, domain: 'g1.globo.com' })
    assert.equal(total, 1)
  })

  it('AC8: paginates with limit and offset while total reflects the full match count, stable across a tied timestamp', async () => {
    // two of the three reforma docs share the exact same published_at in the fixture, on purpose
    const q = { ...docsBase, term: 'reforma', kind: 'word', limit: 1 }
    const first = await docsFor(lula, { ...q, offset: 0 })
    const second = await docsFor(lula, { ...q, offset: 1 })
    assert.equal(first.total, 3)
    assert.equal(second.total, 3)
    assert.equal(first.docs.length, 1)
    assert.equal(second.docs.length, 1)
    const ids = new Set([first.docs[0].id, second.docs[0].id])
    assert.equal(ids.size, 2, 'union of the two pages must not repeat or skip a doc')
  })

  it('AC9: never returns a tone for non-GDELT sources', async () => {
    const { docs: found } = await docsFor(lula, { ...docsBase, source: 'gnews,rss,bluesky' })
    assert.ok(found.every((d) => d.tone === null))
  })

  it('AC9: returns a tone for gkg docs', async () => {
    const { docs: found } = await docsFor(lula, { ...docsBase, source: 'gkg' })
    assert.equal(found.length, 1)
    assert.equal(found[0].tone, 0.6)
  })

  it('AC10: returns an empty result for a person without matching docs', async () => {
    const { total, docs: found } = await docsFor(nobody, docsBase)
    assert.equal(total, 0)
    assert.deepEqual(found, [])
  })

  it('AC10: returns an empty result for an empty window', async () => {
    const { total, docs: found } = await docsFor(lula, { ...docsBase, days: 1 })
    assert.equal(total, 0)
    assert.deepEqual(found, [])
  })

  it('issue #8: a comma-separated source list returns only docs whose source is in the list', async () => {
    const { total, docs: found } = await docsFor(lula, { ...docsBase, source: 'gnews,rss' })
    assert.equal(total, 3)
    assert.ok(found.every((d) => d.source === 'gnews' || d.source === 'rss'))
  })

  it('issue #8: adding gkg to the list includes the gkg doc', async () => {
    const { total, docs: found } = await docsFor(lula, { ...docsBase, source: 'gnews,rss,gkg' })
    assert.equal(total, 4)
    assert.ok(found.some((d) => d.source === 'gkg'))
  })
})

describe('risingFor (issue #3)', () => {
  before(seed)

  // reforma/tributaria/anuncia/disputam/eleicao/tarcisio/hashtag:reforma/defende all sit in the
  // last-7-days recent window against the 8-37-day-ago baseline (default days:7, baseline:30);
  // "estabilidade fiscal" (docs /17-/19, day31/day35/day50) instead lands entirely in the baseline,
  // which is why it never appears at these default windows (see AC5 below).
  const rnode = (r: Awaited<ReturnType<typeof risingFor>>, id: string) => r.terms.find((t) => `${t.kind}:${t.term}` === id)
  const rate = (raw: number, span: number) => Math.round((raw / span) * 100) / 100
  const lift = (cRecent: number, days: number, cBaseline: number, baseline: number) =>
    Math.round(((cRecent / days) / ((cBaseline + 1) / baseline)) * 100) / 100

  it('AC2: sorts terms by lift desc, ties by term', async () => {
    const r = await risingFor(lula, risingBase)
    assert.equal(r.days, 7)
    assert.equal(r.baseline, 30)
    // doc /38 (gkg, day1, issue #8's press-vs-network fixture) adds six single-mention terms
    // ("assina", "estrangeira", "expandir", "parceria", "setor", "tecnologico") to the recent
    // window, each tying by lift with the existing single-mention terms in its tier and
    // interleaving alphabetically within that tier.
    assert.deepEqual(
      r.terms.map((t) => `${t.kind}:${t.term}`),
      [
        'word:reforma', 'word:tributaria', 'word:anuncia', 'word:assina', 'word:disputam', 'word:eleicao',
        'word:estrangeira', 'word:expandir', 'word:parceria', 'hashtag:reforma', 'word:setor', 'word:tarcisio',
        'word:tecnologico', 'word:defende',
      ],
    )
  })

  it('AC3,AC4: count_recent, count_baseline and lift match the pinned formula', async () => {
    const r = await risingFor(lula, risingBase)
    // "tributaria" appears in docs /1 and /6 (both day1, in the recent window) and in no doc in the 8-37 day baseline
    assert.deepEqual(rnode(r, 'word:tributaria'), {
      term: 'tributaria',
      kind: 'word',
      count_recent: rate(2, 7),
      count_baseline: rate(0, 30),
      lift: lift(2, 7, 0, 30),
    })
    // "defende" appears once in doc /6 (day1, recent) and once in doc /17 (day31, baseline)
    const defende = rnode(r, 'word:defende')
    assert.equal(defende?.count_recent, rate(1, 7))
    assert.equal(defende?.count_baseline, rate(1, 30))
    assert.equal(defende?.lift, lift(1, 7, 1, 30))
  })

  it('AC5: a term absent from the baseline outranks a term present in it at a comparable recent rate', async () => {
    const r = await risingFor(lula, risingBase)
    // "anuncia" and "defende" both have exactly 1 recent-window doc; "anuncia" has none in the
    // baseline, "defende" has 1 (doc /17, day31's "estabilidade" text also carries "defende")
    const anuncia = rnode(r, 'word:anuncia')
    const defende = rnode(r, 'word:defende')
    assert.equal(anuncia?.count_recent, defende?.count_recent)
    assert.equal(anuncia?.count_baseline, 0)
    assert.equal(defende?.count_baseline, rate(1, 30))
    assert.ok((anuncia?.lift ?? 0) > (defende?.lift ?? 0))
  })

  it('AC6: a term with an unchanged daily rate has lift exactly 1', async () => {
    const r = await risingFor(lula, { ...risingBase, days: 40, baseline: 40 })
    // "estabilidade"/"fiscal" have 2 mentions in the last 40 days (day31, day35) and 1 in the 40 days before (day50)
    assert.equal(rnode(r, 'word:estabilidade')?.lift, 1)
    assert.equal(rnode(r, 'word:fiscal')?.lift, 1)
  })

  it('AC7: min filters on the raw recent count', async () => {
    const at2 = await risingFor(lula, { ...risingBase, min: 2 })
    assert.ok(rnode(at2, 'word:tributaria'))
    assert.equal(rnode(at2, 'word:anuncia'), undefined, '"anuncia" has a raw recent count of 1')
    const at3 = await risingFor(lula, { ...risingBase, min: 3 })
    assert.equal(rnode(at3, 'word:tributaria'), undefined)
  })

  it('AC8: never lists the person name as a rising term', async () => {
    const excluded = new Set(nameTokens(lula))
    const r = await risingFor(lula, { ...risingBase, days: 2000, baseline: 2000 })
    assert.ok(r.terms.length > 0, 'sanity: wide window must yield rows to make the check meaningful')
    for (const t of r.terms) assert.ok(!excluded.has(t.term), `${t.term} is a name token and must be excluded`)
  })

  it('AC9: kind, source and domain filter both windows identically', async () => {
    const hashtagOnly = await risingFor(lula, { ...risingBase, kind: 'hashtag' })
    assert.ok(hashtagOnly.terms.length > 0)
    assert.ok(hashtagOnly.terms.every((t) => t.kind === 'hashtag'))
    const wordOnly = await risingFor(lula, { ...risingBase, kind: 'word' })
    assert.ok(wordOnly.terms.every((t) => t.kind === 'word'))

    const bluesky = await risingFor(lula, { ...risingBase, source: 'bluesky' })
    assert.ok(bluesky.terms.some((t) => t.term === 'disputam'))
    assert.ok(!bluesky.terms.some((t) => t.term === 'reforma'), 'reforma never appears in the bluesky doc')

    const domainScoped = await risingFor(lula, { ...risingBase, domain: 'g1.globo.com' })
    assert.ok(domainScoped.terms.some((t) => t.term === 'anuncia'))
    assert.ok(!domainScoped.terms.some((t) => t.term === 'defende'), 'defende only appears on valor.globo.com')
  })

  // Issue #108: 'theme' left the recognized kind set, so a term keyed by literal kind='theme'
  // now matches nothing, exactly like any other kind no doc_terms row ever carries.
  it('kind=theme behaves exactly as any other unrecognized kind token: filtered to nothing', async () => {
    const theme = await risingFor(lula, { ...risingBase, kind: 'theme', days: 2000, baseline: 2000 })
    const bogus = await risingFor(lula, { ...risingBase, kind: 'bogus', days: 2000, baseline: 2000 })
    assert.deepEqual(theme.terms, [])
    assert.deepEqual(bogus.terms, [])
  })

  it('AC10: returns an empty terms array for a person without docs', async () => {
    const r = await risingFor(nobody, risingBase)
    assert.deepEqual(r, { days: 7, baseline: 30, terms: [], outlets: [] })
  })

  it('AC10: returns an empty terms array for an empty recent window', async () => {
    const r = await risingFor(lula, { ...risingBase, days: 1 })
    assert.deepEqual(r.terms, [])
  })

  it('AC11: limit clamps the result size without altering the order', async () => {
    const full = await risingFor(lula, { ...risingBase, limit: 100 })
    const r = await risingFor(lula, { ...risingBase, limit: 1 })
    assert.equal(r.terms.length, 1)
    assert.equal(r.terms[0].term, 'reforma')
    assert.deepEqual(r.terms[0], full.terms[0])
  })
})

describe('timelineFor (issue #4)', () => {
  before(seed)

  const golpe = { term: 'golpe', kind: 'word', days: 2140, source: 'all', domain: 'all', lean: 'all' } as const

  it('AC1: returns ceil(days/bucket_days) buckets, oldest first, for the default window', async () => {
    const rows = await timelineFor(lula, timelineBase)
    assert.equal(rows.length, 5)
    for (const r of rows) assert.ok('bucket_start' in r && 'count' in r)
    for (let i = 1; i < rows.length; i++) {
      assert.ok(new Date(rows[i - 1].bucket_start).getTime() < new Date(rows[i].bucket_start).getTime())
    }
  })

  it('AC2: bucket counts sum to the equivalent docsFor total', async () => {
    const rows = await timelineFor(lula, timelineBase)
    const { total } = await docsFor(lula, { ...docsBase, limit: 200 })
    assert.equal(total, 5, 'sanity: known fixture total for lula in the default window')
    assert.equal(sumOf(rows), total)

    const scoped = await timelineFor(bolsonaro, { ...timelineBase, ...golpe })
    const { total: golpeTotal } = await docsFor(bolsonaro, { ...docsBase, ...golpe })
    assert.equal(golpeTotal, 4)
    assert.equal(sumOf(scoped), golpeTotal)
  })

  it('AC3: zero-count buckets are present, not omitted', async () => {
    const rows = await timelineFor(bolsonaro, { ...timelineBase, ...golpe })
    assert.equal(rows.length, 306, 'ceil(2140/7)')
    // doc /23 (2139 days ago) lands in the oldest (edge-clamped) bucket -> row 0
    // doc /22 (2116 days ago) lands 3 week-buckets later -> row 3
    // docs /20,/21 (2102/2105 days ago, same calendar week) merge into one bucket -> row 5
    assert.equal(rows[0].count, 1)
    assert.equal(rows[1].count, 0)
    assert.equal(rows[2].count, 0)
    assert.equal(rows[3].count, 1)
    assert.equal(rows[4].count, 0, 'a zero bucket must separate the row-3 and row-5 clusters')
    assert.equal(rows[5].count, 2)
    assert.deepEqual(rows.filter((r) => r.count > 0).map((r) => r.count).sort((a, b) => b - a), [2, 1, 1])
  })

  it('AC4: day buckets split what a week bucket merges', async () => {
    const day = await timelineFor(bolsonaro, { ...golpe, bucket: 'day' })
    const week = await timelineFor(bolsonaro, { ...golpe, bucket: 'week' })
    assert.equal(day.length, 2140)
    assert.deepEqual(day.filter((r) => r.count > 0).map((r) => r.count).sort(), [1, 1, 1, 1])
    assert.deepEqual(week.filter((r) => r.count > 0).map((r) => r.count).sort((a, b) => b - a), [2, 1, 1])
  })

  it('AC5: without a term, kind has no effect and every doc about the person counts', async () => {
    const q = { ...timelineBase, term: '', days: 2151 }
    const withHashtagKind = await timelineFor(bolsonaro, { ...q, kind: 'hashtag' })
    const withThemeKind = await timelineFor(bolsonaro, { ...q, kind: 'theme' })
    const withAllKind = await timelineFor(bolsonaro, { ...q, kind: 'all' })
    // doc /37 (day 35, issue #5's two-person tone fixture) also names bolsonaro, widening this
    // window's count from 5 to 6
    assert.equal(sumOf(withHashtagKind), 6)
    assert.equal(sumOf(withThemeKind), 6)
    assert.equal(sumOf(withAllKind), 6)
  })

  it('AC6: an unrecognized kind still matches the term under any kind', async () => {
    const bogus = await timelineFor(bolsonaro, { ...timelineBase, ...golpe, kind: 'bogus' })
    const all = await timelineFor(bolsonaro, { ...timelineBase, ...golpe, kind: 'all' })
    assert.equal(sumOf(bogus), 4)
    assert.equal(sumOf(all), 4)
  })

  // Issue #108: 'theme' left the recognized kind set, so kind=theme must fall back the same
  // way kind=bogus already does, not behave like a known-but-empty subset.
  it('AC6: kind=theme still matches the term under any kind, same as kind=bogus', async () => {
    const theme = await timelineFor(bolsonaro, { ...timelineBase, ...golpe, kind: 'theme' })
    assert.equal(sumOf(theme), 4)
  })

  it('AC7: a person without docs gets every bucket at zero', async () => {
    const rows = await timelineFor(nobody, timelineBase)
    assert.equal(rows.length, 5)
    assert.ok(rows.every((r) => r.count === 0))
  })

  it('AC8: an empty window still returns a full, zero-filled bucket list', async () => {
    const rows = await timelineFor(bolsonaro, timelineBase)
    assert.equal(rows.length, 5)
    assert.ok(rows.every((r) => r.count === 0))
    // bolsonaro's earliest doc is 2102 days ago, so a 1-day window is guaranteed empty
    const one = await timelineFor(bolsonaro, { ...timelineBase, days: 1 })
    assert.equal(one.length, 1, 'ceil(1/7) = 1')
    assert.equal(one[0].count, 0)
  })

  it('AC9: source and domain narrow counts the same way they narrow docsFor', async () => {
    const bySource = await timelineFor(bolsonaro, { ...timelineBase, ...golpe, source: 'gnews' })
    const byDomain = await timelineFor(bolsonaro, { ...timelineBase, ...golpe, domain: 'oantagonista.com.br' })
    const byMiss = await timelineFor(bolsonaro, { ...timelineBase, ...golpe, source: 'bluesky' })
    const byMissDomain = await timelineFor(bolsonaro, { ...timelineBase, ...golpe, domain: 'nonexistent.example' })
    assert.equal(sumOf(bySource), 1, 'only doc /21 (oantagonista.com.br) is gnews')
    assert.equal(sumOf(byDomain), 1)
    assert.ok(byMiss.every((r) => r.count === 0))
    assert.ok(byMissDomain.every((r) => r.count === 0))
  })

  it('AC12: no bucket row ever carries a tone field', async () => {
    const rows = await timelineFor(bolsonaro, { ...timelineBase, ...golpe })
    assert.ok(rows.length > 0)
    assert.ok(rows.every((r) => !('tone' in r)))
  })
})

// A doc can only sit *exactly* on a bucket edge if the instant it is dated from and the
// instant timelineFor buckets against are the same one. now() is transaction_timestamp(),
// so an explicit transaction freezes both: each case inserts its docs, dates them by an
// interval from that frozen now(), asserts, and rolls back, leaving the shared fixture
// untouched for the next case.
//
// bolsonaro is the canvas: every fixture doc naming him is 2100+ days old except doc /37
// at day 35, so any window of 30 days holds only what a case inserts.
describe('timelineFor bucket edges against a frozen reference time', () => {
  before(seed)

  const golpe = 'Bolsonaro volta a comentar o golpe em nota oficial'
  const quiet = 'Bolsonaro visita uma cooperativa agrícola no litoral'

  type Placed = { offset: string; text?: string; source?: Source; domain?: string }

  // offset is subtracted from the frozen now(), so '7 days' is exactly one week old and
  // '-1 days' is a day in the future.
  // The rollback travels as a thrown sentinel because `inTransaction` commits on success. Going
  // through it rather than a raw `begin` is what keeps now() frozen: the store tracks whether a
  // transaction is open, and an unseen one makes insertDoc open and commit its own.
  const rollback = new Error('rollback')

  const withDocs = (placed: Placed[], run: () => Promise<void>) =>
    inTransaction(async () => {
      for (const [i, p] of placed.entries()) {
        const uri = `https://example.org/boundary/${i}`
        await insertDoc(
          { source: p.source ?? 'rss', uri, text: p.text ?? golpe, publishedAt: new Date().toISOString(), domain: p.domain ?? 'example.org' },
          persons,
        )
        await db.query(`update docs set published_at = now() - ($1)::interval where uri = $2`, [p.offset, uri])
      }
      await run()
      throw rollback
    }).catch((e) => {
      if (e !== rollback) throw e
    })

  const totalFor = async (q: TimelineQuery) =>
    (await docsFor(bolsonaro, { term: q.term, kind: q.kind, days: q.days, source: q.source, domain: q.domain, lean: q.lean, limit: 500, offset: 0 })).total

  it('a doc exactly one bucket width old lands in the newest bucket, not the second', async () => {
    await withDocs([{ offset: '7 days' }], async () => {
      const rows = await timelineFor(bolsonaro, timelineBase)
      assert.equal(rows.length, 5)
      assert.equal(rows[4].count, 1, 'newest bucket is [now() - 7 days, infinity)')
      assert.equal(sumOf(rows), 1)
    })
  })

  it('a microsecond past that edge falls into the next-older bucket', async () => {
    await withDocs([{ offset: '7 days 00:00:00.000001' }], async () => {
      const rows = await timelineFor(bolsonaro, timelineBase)
      assert.equal(rows[4].count, 0)
      assert.equal(rows[3].count, 1)
      assert.equal(sumOf(rows), 1)
    })
  })

  it('the same edge rule holds for day buckets', async () => {
    await withDocs([{ offset: '1 day' }, { offset: '1 day 00:00:00.000001' }], async () => {
      const rows = await timelineFor(bolsonaro, { ...timelineBase, bucket: 'day' })
      assert.equal(rows.length, 30)
      assert.equal(rows[29].count, 1)
      assert.equal(rows[28].count, 1)
      assert.equal(sumOf(rows), 2)
    })
  })

  it('a doc exactly at the oldest edge of the window is kept, in the oldest bucket', async () => {
    await withDocs([{ offset: '30 days' }], async () => {
      const rows = await timelineFor(bolsonaro, timelineBase)
      assert.equal(rows[0].count, 1)
      assert.equal(sumOf(rows), 1)
      assert.equal(await totalFor(timelineBase), 1, 'docsFor keeps it too: the window edge is inclusive')
    })
  })

  it('a microsecond older than the window is outside it, for the timeline as for docsFor', async () => {
    await withDocs([{ offset: '30 days 00:00:00.000001' }], async () => {
      const rows = await timelineFor(bolsonaro, timelineBase)
      assert.equal(rows.length, 5)
      assert.ok(rows.every((r) => r.count === 0))
      assert.equal(await totalFor(timelineBase), 0)
    })
  })

  it('the oldest week bucket is the partial one: 30 days over 7-day buckets leaves it 2 days wide', async () => {
    await withDocs([{ offset: '29 days 23:59:59' }, { offset: '28 days' }, { offset: '27 days 23:59:59' }], async () => {
      const rows = await timelineFor(bolsonaro, timelineBase)
      assert.equal(rows.length, 5, 'ceil(30/7)')
      assert.equal(rows[0].count, 1, 'only the doc older than 28 days sits in the clamped oldest bucket')
      assert.equal(rows[1].count, 2, 'the 28-day edge belongs to the newer, full-width bucket')
      assert.equal(sumOf(rows), 3)
    })
  })

  it('future-dated docs still belong to the newest bucket and still count toward the total', async () => {
    await withDocs([{ offset: '-1 days' }, { offset: '-400 days' }, { offset: '0 days' }], async () => {
      const rows = await timelineFor(bolsonaro, timelineBase)
      assert.equal(rows[4].count, 3)
      assert.equal(sumOf(rows), 3)
      assert.equal(await totalFor(timelineBase), 3)
    })
  })

  it('counts sum to the docsFor total across every bucket width, edges and future dates included', async () => {
    const placed: Placed[] = [
      { offset: '-3 days' },
      { offset: '0 days' },
      { offset: '7 days' },
      { offset: '7 days 00:00:00.000001' },
      { offset: '13 days 12:00:00' },
      { offset: '21 days' },
      { offset: '28 days' },
      { offset: '30 days' },
    ]
    await withDocs(placed, async () => {
      for (const bucket of ['day', 'week'] as const) {
        const q = { ...timelineBase, bucket }
        const rows = await timelineFor(bolsonaro, q)
        assert.equal(rows.length, bucket === 'day' ? 30 : 5)
        assert.equal(sumOf(rows), placed.length)
        assert.equal(sumOf(rows), await totalFor(q))
      }
    })
  })

  it('holds over a 365-day window, where the bucket series is at its widest', async () => {
    const q = { ...timelineBase, term: 'golpe', kind: 'word', days: 365, bucket: 'day' as const }
    await withDocs([{ offset: '-1 days' }, { offset: '0 days' }, { offset: '364 days 23:59:59' }, { offset: '365 days' }], async () => {
      const rows = await timelineFor(bolsonaro, q)
      assert.equal(rows.length, 365)
      assert.equal(rows[364].count, 2, 'today and tomorrow share the newest bucket')
      assert.equal(rows[0].count, 2, 'both docs at the clamped oldest edge stay in the series')
      assert.equal(sumOf(rows), 4)
      assert.equal(sumOf(rows), await totalFor(q))
    })
  })

  it('term, kind, source and domain narrow the buckets exactly as they narrow docsFor', async () => {
    const placed: Placed[] = [
      { offset: '2 days' },
      { offset: '9 days', source: 'gnews', domain: 'oantagonista.com.br' },
      { offset: '16 days', text: quiet },
    ]
    await withDocs(placed, async () => {
      const cases: TimelineQuery[] = [
        { ...timelineBase, term: 'golpe', kind: 'word' },
        { ...timelineBase, term: 'golpe', kind: 'hashtag' },
        { ...timelineBase, term: 'golpe', kind: 'not-a-real-kind' },
        { ...timelineBase, source: 'gnews' },
        { ...timelineBase, domain: 'oantagonista.com.br' },
        { ...timelineBase, source: 'bluesky' },
        { ...timelineBase, domain: 'nonexistent.example' },
      ]
      for (const q of cases) {
        const rows = await timelineFor(bolsonaro, q)
        assert.equal(rows.length, 5, JSON.stringify(q))
        assert.equal(sumOf(rows), await totalFor(q), JSON.stringify(q))
      }
      assert.equal(sumOf(await timelineFor(bolsonaro, { ...timelineBase, term: 'golpe', kind: 'word' })), 2)
      assert.equal(sumOf(await timelineFor(bolsonaro, { ...timelineBase, term: 'golpe', kind: 'hashtag' })), 0)
      assert.equal(sumOf(await timelineFor(bolsonaro, { ...timelineBase, source: 'bluesky' })), 0)
    })
  })

  it('every bucket in an empty scope is present and zero, in ascending order', async () => {
    await withDocs([{ offset: '3 days' }], async () => {
      const rows = await timelineFor(bolsonaro, { ...timelineBase, source: 'bluesky', bucket: 'day' })
      assert.equal(rows.length, 30)
      assert.ok(rows.every((r) => r.count === 0))
      for (let i = 1; i < rows.length; i++) {
        assert.ok(new Date(rows[i - 1].bucket_start).getTime() < new Date(rows[i].bucket_start).getTime())
      }
    })
  })

  it('rolls back cleanly: the fixture window is empty again', async () => {
    const rows = await timelineFor(bolsonaro, timelineBase)
    assert.equal(rows.length, 5)
    assert.ok(rows.every((r) => r.count === 0))
  })
})

// The future-dated doc is picked up by `scope` (person-agnostic) for *any* days/source/domain='all'
// query, which would shift every hardcoded pmi/stats literal above; hence the reseed.
describe('timelineFor: future-dated doc', () => {
  before(async () => {
    await seed()
    await insertDoc(futureDoc, persons)
  })
  after(reseed)

  it('lands in the newest bucket instead of falling through the open upper bound', async () => {
    const rows = await timelineFor(bolsonaro, { ...timelineBase, term: 'golpe', kind: 'word' })
    assert.ok(rows.length > 0)
    assert.equal(rows[rows.length - 1].count, 1, 'the newest (last) bucket must hold the future doc')
  })

  it('keeps the bucket-sum invariant against docsFor total when a doc is future-dated', async () => {
    const q = { term: 'golpe', kind: 'word', days: 30, source: 'all', domain: 'all', lean: 'all' } as const
    const rows = await timelineFor(bolsonaro, { ...q, bucket: 'week' })
    const { total } = await docsFor(bolsonaro, { ...q, limit: 50, offset: 0 })
    assert.equal(total, 1, 'sanity: only the future doc falls inside this 30-day window')
    assert.equal(sumOf(rows), total)
  })
})

describe('toneFor (issue #5)', () => {
  before(seed)

  const cell = (r: Awaited<ReturnType<typeof toneFor>>, personId: string, domain: string) =>
    r.cells.find((c) => c.person_id === personId && c.domain === domain)

  it('AC1: the response has exactly the keys persons, domains, cells', async () => {
    const r = await toneFor(toneBase)
    assert.deepEqual(Object.keys(r).sort(), ['cells', 'domains', 'persons'])
  })

  it('AC4: lists every tracked person regardless of toned docs, ordered by name, shaped { id, name }', async () => {
    const r = await toneFor(toneBase)
    assert.deepEqual(r.persons.map((p) => p.id).sort(), ['bolsonaro', 'lula', 'tarcisio'])
    for (const p of r.persons) assert.deepEqual(Object.keys(p).sort(), ['id', 'name'])
    const names = r.persons.map((p) => p.name)
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)))
  })

  it('AC5: drops person/domain pairs below min', async () => {
    const r = await toneFor(toneBase)
    // folha.uol.com.br has exactly 1 toned tarcisio doc, oglobo.globo.com has 2: both below the default min=3
    assert.equal(cell(r, 'tarcisio', 'folha.uol.com.br'), undefined)
    assert.equal(cell(r, 'tarcisio', 'oglobo.globo.com'), undefined)
    assert.ok(!r.cells.some((c) => c.n < toneBase.min), 'no surfaced cell may carry n below the threshold')
  })

  it('AC6: includes pairs at or above min with the correct average and count', async () => {
    const r = await toneFor(toneBase)
    // estadao.com.br has 3 toned tarcisio docs (-2, -1, 0), averaging to -1
    assert.deepEqual(cell(r, 'tarcisio', 'estadao.com.br'), { person_id: 'tarcisio', domain: 'estadao.com.br', tone: -1, n: 3 })
  })

  it('excludes an untoned doc from a surfaced cell instead of counting it', async () => {
    // doc /36 is an untoned rss doc, same person and domain as the estadao.com.br cell above;
    // if toneSql ever swapped count(d.tone)/avg(d.tone) for count(*)/avg(coalesce(d.tone,0)),
    // this cell would silently become { tone: -0.75, n: 4 } instead
    const r = await toneFor(toneBase)
    assert.deepEqual(cell(r, 'tarcisio', 'estadao.com.br'), { person_id: 'tarcisio', domain: 'estadao.com.br', tone: -1, n: 3 })
  })

  it('counts a doc mentioning two tracked persons once in each person group', async () => {
    // doc /37 names both tarcisio and bolsonaro, toned 0.4, on poder360.com.br; it sits at day
    // 35, outside the default 30-day window, so a wider window is used here
    const r = await toneFor({ days: 90, min: 1 })
    assert.deepEqual(cell(r, 'tarcisio', 'poder360.com.br'), { person_id: 'tarcisio', domain: 'poder360.com.br', tone: 0.4, n: 1 })
    assert.deepEqual(cell(r, 'bolsonaro', 'poder360.com.br'), { person_id: 'bolsonaro', domain: 'poder360.com.br', tone: 0.4, n: 1 })
  })

  it('AC7: has no cells for a person without toned docs, who still appears in persons', async () => {
    const r = await toneFor(toneBase)
    assert.ok(!r.cells.some((c) => c.person_id === 'lula'))
    assert.ok(!r.cells.some((c) => c.person_id === 'bolsonaro'))
    assert.ok(r.persons.some((p) => p.id === 'lula'), 'lula still appears in persons')
  })

  it('excludes domains that never appear in any surfaced cell', async () => {
    const r = await toneFor(toneBase)
    assert.ok(r.domains.includes('estadao.com.br'))
    assert.ok(!r.domains.includes('oglobo.globo.com'), 'below-min pair must not leak its domain')
    assert.ok(!r.domains.includes('folha.uol.com.br'), 'below-min pair must not leak its domain')
    assert.deepEqual([...r.domains].sort(), r.domains, 'domains must be sorted')
  })

  it('AC9: lowers the threshold when min is set explicitly', async () => {
    const atDefault = await toneFor(toneBase)
    assert.equal(cell(atDefault, 'tarcisio', 'oglobo.globo.com'), undefined)
    const lowered = await toneFor({ ...toneBase, min: 2 })
    assert.deepEqual(cell(lowered, 'tarcisio', 'oglobo.globo.com'), { person_id: 'tarcisio', domain: 'oglobo.globo.com', tone: 0.75, n: 2 })
  })

  it('AC8: ignores docs without a domain, even when one alone clears min', async () => {
    // doc /35 has no domain but a tone of -3 about tarcisio; it must never surface a
    // null/empty domain even at a min low enough to admit a lone toned doc
    const r = await toneFor({ ...toneBase, min: 1 })
    assert.ok(!r.domains.some((d) => !d))
    assert.ok(!r.cells.some((c) => !c.domain))
  })

  it('returns an empty matrix outside any docs window', async () => {
    // every new toned doc is at least 6 days old
    const r = await toneFor({ days: 1, min: 1 })
    assert.deepEqual(r.cells, [])
    assert.deepEqual(r.domains, [])
    assert.equal(r.persons.length, 3)
  })
})

describe('testimonyFor (issue #21)', () => {
  before(seed)

  const byDomain = (r: Awaited<ReturnType<typeof testimonyFor>>, domain: string) => r.by_domain.find((d) => d.domain === domain)
  const bySource = (r: Awaited<ReturnType<typeof testimonyFor>>, source: string) => r.by_source.find((s) => s.source === source)

  it('computes overall/by_source/by_domain within the default window', async () => {
    // docs 30-35 about tarcisio, all gdelt: scores 4, 6, 2, 5, -1, -8 (doc 36 is null, doc 37 is
    // outside days:30) -> n=6, avg = 8/6 = 1.33
    const r = await testimonyFor(tarcisio, testimonyBase)
    assert.equal(r.method, 'stub')
    assert.deepEqual(r.overall, { score: 1.33, n: 6 })
    assert.deepEqual(r.by_source, [{ source: 'gdelt', score: 1.33, n: 6 }])
    assert.deepEqual(r.by_domain, [{ domain: 'estadao.com.br', source: 'gdelt', score: 4, n: 3 }])
  })

  it('AC6: excludes a null-scored doc from n and the average at every level', async () => {
    // doc /36 shares tarcisio+estadao.com.br+the default window with docs 30-32, but is
    // scored null; if count(score)/avg(score) were swapped for count(*)/coalesce(score,0)
    // the estadao.com.br cell would silently become { score: 3, n: 4 }
    const r = await testimonyFor(tarcisio, testimonyBase)
    assert.deepEqual(byDomain(r, 'estadao.com.br'), { domain: 'estadao.com.br', source: 'gdelt', score: 4, n: 3 })
    assert.equal(r.overall.n, 6, 'the null-scored doc must not inflate n')
  })

  it('AC4: drops a domain below min from by_domain but keeps it in overall/by_source, and surfaces it once min is lowered', async () => {
    // oglobo.globo.com has 2 non-null tarcisio scores (5, -1): below the default min=3
    const r = await testimonyFor(tarcisio, testimonyBase)
    assert.equal(byDomain(r, 'oglobo.globo.com'), undefined)
    assert.equal(r.overall.n, 6, 'oglobo.globo.com docs still count toward overall')
    const lowered = await testimonyFor(tarcisio, { ...testimonyBase, min: 2 })
    assert.deepEqual(byDomain(lowered, 'oglobo.globo.com'), { domain: 'oglobo.globo.com', source: 'gdelt', score: 2, n: 2 })
  })

  it('AC5: never groups a domain-less doc into by_domain, at any min, but keeps it in overall/by_source', async () => {
    // doc /35 (example.org, tarcisio, score -8) has no domain; the -8 is baked into the 1.33
    // average, proving it was counted
    const r = await testimonyFor(tarcisio, { ...testimonyBase, min: 1 })
    assert.ok(!r.by_domain.some((d) => !d.domain))
    assert.deepEqual(bySource(r, 'gdelt'), { source: 'gdelt', score: 1.33, n: 6 })
  })

  it('AC7: keeps a shared doc independent per person: no cross-leak', async () => {
    // doc /37 (poder360.com.br) scores tarcisio +7, bolsonaro -7; sits at day 35, so days:90 is needed
    const wide: TestimonyQuery = { days: 90, source: 'all', method: 'stub', min: 1 }
    const t = await testimonyFor(tarcisio, wide)
    const b = await testimonyFor(bolsonaro, wide)
    assert.deepEqual(byDomain(t, 'poder360.com.br'), { domain: 'poder360.com.br', source: 'gdelt', score: 7, n: 1 })
    assert.deepEqual(byDomain(b, 'poder360.com.br'), { domain: 'poder360.com.br', source: 'gdelt', score: -7, n: 1 })
    assert.deepEqual(b.overall, { score: -7, n: 1 })
    // tarcisio's own 7 scores (4, 6, 2, 5, -1, -8, 7) sum to 15, avg 15/7 = 2.14 -- bolsonaro's
    // -7 for the same doc never enters this average
    assert.deepEqual(t.overall, { score: 2.14, n: 7 })
  })

  it('AC8: excludes docs outside the days window; widening includes them', async () => {
    const narrow = await testimonyFor(tarcisio, testimonyBase)
    assert.equal(byDomain(narrow, 'poder360.com.br'), undefined)
    const wide = await testimonyFor(tarcisio, { ...testimonyBase, days: 90, min: 1 })
    assert.ok(byDomain(wide, 'poder360.com.br'))
    // lula: g1.globo.com/5, gnews, 100 days ago, score -2 -- outside the default days:30
    const narrowDays = await testimonyFor(lula, testimonyBase)
    assert.deepEqual(narrowDays.overall, { score: 4.5, n: 2 })
    const widerDays = await testimonyFor(lula, { ...testimonyBase, days: 200 })
    assert.deepEqual(widerDays.overall, { score: Math.round(((6 + 3 - 2) / 3) * 100) / 100, n: 3 })
  })

  it('AC8/AC9: excludes docs outside the source filter, with parseSourceList grammar; widening includes them', async () => {
    // lula: g1.globo.com/1 (gnews, score 6) and gdeltproject.org/38 (gkg, score 3), both day1
    const onlyGkg = await testimonyFor(lula, { ...testimonyBase, source: 'gkg' })
    assert.deepEqual(onlyGkg.overall, { score: 3, n: 1 })
    assert.deepEqual(onlyGkg.by_source, [{ source: 'gkg', score: 3, n: 1 }])
    const withBogus = await testimonyFor(lula, { ...testimonyBase, source: 'gkg,bogus' })
    assert.deepEqual(withBogus.overall, onlyGkg.overall)
    const gnewsOnly = await testimonyFor(lula, { ...testimonyBase, source: 'gnews' })
    assert.deepEqual(gnewsOnly.overall, { score: 6, n: 1 })
    const all = await testimonyFor(lula, { ...testimonyBase, source: 'all' })
    assert.deepEqual(all.overall, { score: 4.5, n: 2 })
    assert.deepEqual((await testimonyFor(lula, { ...testimonyBase, source: 'gnews,gkg' })).overall, all.overall)
  })

  it('AC3: returns the all-empty shape for an unknown/never-scored method, and for a source with no scored doc', async () => {
    const r = await testimonyFor(tarcisio, { ...testimonyBase, method: 'never-inserted-method' })
    assert.deepEqual(r, { method: 'never-inserted-method', overall: { score: null, n: 0 }, by_source: [], by_domain: [] })
    // lula has zero bluesky-sourced testimony rows in the fixture
    const noDocs = await testimonyFor(lula, { ...testimonyBase, source: 'bluesky' })
    assert.deepEqual(noDocs.overall, { score: null, n: 0 })
  })
})

describe('compareFor (issue #93)', () => {
  before(seed)

  const term = (r: Awaited<ReturnType<typeof compareFor>>, t: string, kind = 'word') => r.terms.find((x) => x.term === t && x.kind === kind)

  it('AC6: returns an exact figure for a term only one side has, and null, not a zero object, for the other', async () => {
    // bolsonaro has zero docs in the default 30-day window (its docs sit 2100+ days out),
    // so "reforma" (lula-only in that window) must carry a real object on a
    const r = await compareFor(lula, bolsonaro, compareBase)
    assert.equal(r.b.about, 0)
    assert.deepEqual(term(r, 'reforma'), { term: 'reforma', kind: 'word', a: { count: 3, pmi: 1.38, tone: null }, b: null })
    assert.notDeepEqual(term(r, 'reforma')!.b, { count: 0, pmi: 0, tone: null })
  })

  it("AC7: symmetrically, a term only tarcisio's docs carry reads real for a and null for b", async () => {
    const g = await graphFor(tarcisio, { ...graphBase, limit: 200 })
    const n = g.nodes.find((x) => x.term === 'geopolitica' && x.kind === 'word')!
    assert.ok(n, 'fixture assumption: tarcisio has a "geopolitica" word node lula never mentions')
    const r = await compareFor(tarcisio, lula, compareBase)
    assert.deepEqual(term(r, 'geopolitica')!.a, { count: n.count, pmi: n.pmi, tone: n.tone })
    assert.equal(term(r, 'geopolitica')!.b, null)
  })

  it('AC8: marks a side\'s own name word as "name" while the other side may still have a real figure', async () => {
    // doc /2 ("Lula e Tarcísio disputam a eleição") gives lula's own docs the word "tarcisio"
    // as ordinary vocabulary, while it is tarcisio's own name word
    const r = await compareFor(tarcisio, lula, compareBase)
    const row = term(r, 'tarcisio')!
    assert.equal(row.a, 'name')
    assert.deepEqual(row.b, { count: 1, pmi: -1.79, tone: null })
  })

  it("AC5: matches graphFor's about for the same query, on both sides", async () => {
    const gLula = await graphFor(lula, parseQuery({}))
    const gBolsonaro = await graphFor(bolsonaro, parseQuery({}))
    const r = await compareFor(lula, bolsonaro, compareBase)
    assert.equal(r.a.about, gLula.stats.about)
    assert.equal(r.b.about, gBolsonaro.stats.about)
    assert.ok(r.a.about > 0)
  })

  it("AC9: matches graphFor's count/pmi/tone for an overlapping term", async () => {
    const g = await graphFor(lula, parseQuery({}))
    const n = g.nodes.find((x) => x.term === 'reforma' && x.kind === 'word')!
    const r = await compareFor(lula, bolsonaro, compareBase)
    assert.deepEqual(term(r, 'reforma')!.a, { count: n.count, pmi: n.pmi, tone: n.tone })
  })

  it('AC10: returns identical a/b values when a === b', async () => {
    // "name" entries never actually surface here: a person's own name words are excluded from
    // term_p before the top-count/top-pmi selection runs (compareSideCte), so when a and b are
    // the same person, both sides' four selection lists are built from the same name-excluded
    // pool and can never select that person's own name word into the union in the first place.
    const r = await compareFor(lula, lula, { ...compareBase, days: 365 })
    assert.ok(r.terms.length > 0)
    for (const t of r.terms) assert.deepEqual(t.a, t.b)
  })

  it('AC11: applies both the count-ranked and pmi-ranked selection per side', async () => {
    // at limit=1, tarcisio's own top-count term ("geopolitica") differs from bolsonaro's
    // top-pmi term ("alianca", shared doc /37), so the union must carry both
    const r = await compareFor(tarcisio, bolsonaro, { ...compareBase, days: 365, limit: 1 })
    assert.ok(r.terms.length > 1, 'both selection criteria must contribute distinct keys')
    assert.ok(r.terms.some((t) => t.term === 'geopolitica'))
    assert.ok(r.terms.some((t) => t.term === 'alianca'))
  })

  it('AC11: limit=1 unions both selections of one side too, not just each side\'s single best term', async () => {
    // scoped to a domain used by no other fixture doc: bolsonaro's own top-count term
    // ("termdiluido", count 3, diluted pmi because lula also uses it) genuinely differs from
    // bolsonaro's own top-pmi term ("cita", count 1, exclusive)
    const scope = { days: 3650, source: 'all', domain: 'testcorp.example', lean: 'all', kind: 'all', limit: 1 } as const
    const gCount = await graphFor(bolsonaro, { ...scope, min: 1, sort: 'count' })
    const gPmi = await graphFor(bolsonaro, { ...scope, min: 1, sort: 'pmi' })
    assert.notEqual(gCount.nodes[0]?.term, gPmi.nodes[0]?.term, "fixture assumption: bolsonaro's own top-count and top-pmi terms differ at this scope")
    const r = await compareFor(bolsonaro, lula, scope)
    assert.ok(r.terms.length > 1)
    assert.ok(r.terms.some((t) => t.term === gCount.nodes[0]!.term), 'the count-ranked top-1 must survive the union')
    assert.ok(r.terms.some((t) => t.term === gPmi.nodes[0]!.term), 'the pmi-ranked top-1 must survive the union')
  })

  it('AC12: orders terms by term asc then kind asc', async () => {
    // "reforma" is both a hashtag and a word for lula in the default window
    const r = await compareFor(lula, bolsonaro, compareBase)
    const idx = r.terms.map((t) => `${t.term}:${t.kind}`)
    const sorted = [...idx].sort((x, y) => {
      const [xt, xk] = x.split(':')
      const [yt, yk] = y.split(':')
      return xt === yt ? (xk < yk ? -1 : xk > yk ? 1 : 0) : xt < yt ? -1 : 1
    })
    assert.deepEqual(idx, sorted)
    assert.ok(r.terms.some((t) => t.term === 'reforma' && t.kind === 'hashtag'))
    assert.ok(r.terms.some((t) => t.term === 'reforma' && t.kind === 'word'))
  })

  it('AC13: returns an empty terms list and about: 0 outside any docs window', async () => {
    const r = await compareFor(lula, bolsonaro, { ...compareBase, domain: 'doesnotexist.example' })
    assert.deepEqual(r.terms, [])
    assert.equal(r.a.about, 0)
    assert.equal(r.b.about, 0)
  })
})

// docsWhereSql carries its own copy of the kind set, used only to decide whether an
// unrecognized kind list falls back to matching any kind (issue #108's own postmortem: a stale
// copy here would silently start treating an unknown token as a known, empty subset instead of
// falling back like every other route). This pins the two in sync instead of re-typing a third
// copy that could drift from both.
describe('the kind set query.ts and graph.ts agree on (issue #108)', () => {
  it('matches KINDS against the literal array embedded in docsWhereSql', () => {
    const literal = docsWhereSql.match(/<@ array\[([^\]]+)\]/)?.[1]
    assert.ok(literal, 'docsWhereSql must embed a kind array literal')
    const embedded = literal.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    assert.deepEqual(embedded, KINDS)
  })

  it('no longer accepts the token theme', () => {
    assert.ok(!KINDS.includes('theme'))
  })

  // tsc enforces this at compile time (pnpm typecheck); this pins the same fact in the source
  // text itself, so a regression is caught by `pnpm test` too.
  it('src/types.ts declares Term.kind as exactly hashtag | word | phrase, never theme', () => {
    const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8')
    const m = /export type Term = \{[^}]*kind:\s*([^}]+)\}/.exec(types)
    assert.ok(m, 'Term type must be declared in src/types.ts')
    const union = [...m![1].matchAll(/'(\w+)'/g)].map((x) => x[1])
    assert.deepEqual(union, ['hashtag', 'word', 'phrase'])
  })
})

// `statements` is what `pnpm bench` and the SQL-reading tests see; the routes run what
// `queries` builds. The two only agree because a builder numbers its placeholders by the
// statement's shape, never by the values, so this pins that the sample text is the route's text.
describe('statements render the same text the routes run (issue #131)', () => {
  const scope = { days: 7, source: 'rss,gkg', domain: 'folha.uol.com.br', lean: 'all', kind: 'word,phrase' }

  it('for every builder, with different values', () => {
    const built = {
      graph: queries.graph(lula, { ...scope, min: 5, sort: 'pmi', limit: 10 }),
      links: queries.links(lula, scope, ['word:a', 'word:b']),
      sources: queries.sources(lula, scope),
      docs: queries.docs(lula, { ...scope, term: 'x', kind: 'phrase', limit: 10, offset: 20 }),
      docsCount: queries.docsCount(lula, { ...scope, term: 'x', kind: 'phrase', limit: 10, offset: 20 }),
      timeline: queries.timeline(lula, { ...scope, term: 'x', kind: 'phrase', bucket: 'week' }),
      rising: queries.rising(lula, { ...scope, baseline: 14, min: 1, limit: 5 }),
      tone: queries.tone({ days: 1, min: 1 }),
      testimonySummary: queries.testimonySummary(lula, { days: 1, source: 'rss', method: 'kikori', min: 1 }),
      termTestimony: queries.termTestimony(lula, scope, 'kikori', ['word:a']),
      candidates: queries.candidates({ days: 1, min: 1, limit: 1 }),
      compare: queries.compare(lula, tarcisio, { ...scope, limit: 5 }),
    }
    for (const name of Object.keys(statements) as (keyof typeof statements)[]) {
      assert.equal(built[name].text, statements[name], name)
    }
  })

  it('binds exactly as many values as placeholders, and numbers them in order', () => {
    for (const [name, text] of Object.entries(statements)) {
      const placeholders = text.match(/\$\d+/g) ?? []
      assert.deepEqual(placeholders, placeholders.map((_, i) => `$${i + 1}`), name)
    }
    const q = queries.graph(lula, { ...scope, min: 5, sort: 'pmi', limit: 10 })
    assert.equal((q.text.match(/\$\d+/g) ?? []).length, q.values.length)
  })
})

// ---------------------------------------------------------------------------------------------
// Reference implementations. Issue #45 merged the three statements that produced stats, nodes
// and signature into one; issue #47 replaced count(distinct doc_id) with count(*) in the term,
// signature, rising and link paths and added `tone is not null` to the tone matrix; issue #48
// merged the three testimony statements into one GROUPING SETS pass. The statements each of
// them replaced are kept here verbatim, so every case below asserts the shipped statement
// returns the same thing field by field, for the same parameters, instead of re-pinning
// literals that could be recomputed to match a regression.
//
// The #47 references carry the one deliberate ordering change with them: `kind` now closes the
// order by of nodes, signature and rising. Two kinds of one term text tying on (count/pmi/lift,
// term) were previously ranked by nothing at all, so the reference statements would otherwise
// differ from the shipped ones purely by plan. The tie itself is pinned separately below.

const scopeCte = `
  scope as (
    select d.id from docs d
    where d.published_at >= now() - make_interval(days => $2)
      and ($3 = 'all' or d.source = any(string_to_array($3, ',')))
      and ($4 = 'all' or d.domain = any(string_to_array($4, ',')))
  ),
  about as (
    select dp.doc_id from doc_persons dp join scope s on s.id = dp.doc_id where dp.person_id = $1
  )`

const trackedCte = `
  tracked as (
    select s.id from scope s where exists (select 1 from doc_persons dp where dp.doc_id = s.id)
  )`

const termsSql = `
  with ${scopeCte}, ${trackedCte},
  n as (select count(*)::float8 as total from tracked),
  np as (select count(*)::float8 as total from about),
  term_all as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_t
    from doc_terms t join tracked s on s.id = t.doc_id group by 1, 2
  ),
  term_p as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_pt, avg(d.tone)::float8 as tone
    from doc_terms t join about a on a.doc_id = t.doc_id join docs d on d.id = t.doc_id
    where ($5 = 'all' or t.kind = $5) and not (t.term = any($6::text[]))
    group by 1, 2
  ),
  scored as (
    select p.term, p.kind, p.c_pt::int as count, p.tone,
      ln((p.c_pt * n.total) / (np.total * a.c_t)) / ln(2) as pmi
    from term_p p join term_all a using (term, kind), n, np
    where p.c_pt >= $7
  )
  select term, kind, count, round(pmi::numeric, 2)::float8 as pmi, round(tone::numeric, 2)::float8 as tone from scored
  order by (case when $8 = 'pmi' then pmi * ln(1 + count) else count end) desc, term
  limit $9`

const signatureSql = `
  with ${scopeCte}, ${trackedCte},
  n as (select count(*)::float8 as total from tracked),
  np as (select count(*)::float8 as total from about),
  term_all as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_t
    from doc_terms t join tracked s on s.id = t.doc_id group by 1, 2
  ),
  term_p as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_pt
    from doc_terms t join about a on a.doc_id = t.doc_id
    where not (t.term = any($5::text[]))
    group by 1, 2
  ),
  scored as (
    select p.term, p.kind, p.c_pt::int as count,
      ln((p.c_pt * n.total) / (np.total * a.c_t)) / ln(2) as pmi
    from term_p p join term_all a using (term, kind), n, np
    where p.c_pt >= greatest(3, np.total * 0.05)
  )
  select term, kind, count, round(pmi::numeric, 2)::float8 as pmi from scored
  order by pmi desc, term
  limit 5`

const statsSql = `
  with ${scopeCte}
  select (select count(*) from scope)::int as docs, (select count(*) from about)::int as about`

const splitGraph = async (person: Person, q: GraphQuery) => {
  const exclude = nameTokens(person)
  const { domain } = resolveScope(q.domain, q.lean)
  const [terms, stats, signature] = await Promise.all([
    db.query<Record<string, unknown>>(termsSql, [person.id, q.days, q.source, domain, q.kind, exclude, q.min, q.sort, q.limit]),
    db.query<Record<string, unknown>>(statsSql, [person.id, q.days, q.source, domain]),
    db.query<Record<string, unknown>>(signatureSql, [person.id, q.days, q.source, domain, exclude]),
  ])
  return { stats: stats.rows[0], nodes: terms.rows, signature: signature.rows }
}


const splitCases: [string, Person, GraphQuery][] = [
  ['default window', lula, graphBase],
  ['sort=pmi over a wide window', lula, { ...graphBase, days: 365, sort: 'pmi', limit: 10 }],
  ['sort=pmi with the same limit as the tie set', lula, { ...graphBase, days: 2000, sort: 'pmi', limit: 200, min: 1 }],
  ['kind=hashtag', lula, { ...graphBase, kind: 'hashtag' }],
  ['kind=word with a min floor and a tight limit', lula, { ...graphBase, kind: 'word', min: 2, limit: 3 }],
  ['kind=theme, a kind this fixture never stores', lula, { ...graphBase, kind: 'theme' }],
  ['min above every count, so no node survives', lula, { ...graphBase, min: 999 }],
  ['a comma-separated source list', lula, { ...graphBase, source: 'gnews,rss,gkg' }],
  ['a single source', lula, { ...graphBase, source: 'bluesky' }],
  ['a source the person has no docs in', lula, { ...graphBase, source: 'senado' }],
  ['a domain filter', lula, { ...graphBase, domain: 'g1.globo.com' }],
  ['toned gdelt docs', tarcisio, graphBase],
  ['toned and untoned docs mixed in one window', tarcisio, { ...graphBase, days: 365, min: 1, limit: 200 }],
  ['a lean filter', bolsonaro, { ...graphBase, days: 2210, lean: 'left' }],
  ['a domain and lean intersection that is empty', bolsonaro, { ...graphBase, days: 2210, domain: 'g1.globo.com', lean: 'left' }],
  ['signature ties at 1000 days', lula, { ...graphBase, days: 1000 }],
  ['signature ties at 2000 days', lula, { ...graphBase, days: 2000 }],
  ['a person with no docs at all', nobody, graphBase],
  ['a window with no docs at all', lula, { ...graphBase, days: 1, source: 'camara' }],
]


// The point of the merge is the statement count, so it is asserted rather than described.
// The instrumentation in src/perf.ts is off in tests (PERF unset), so this counts through a
// temporary own property on the handle and restores the prototype method afterwards.
const countStatements = async (fn: () => Promise<unknown>) => {
  const original = db.query.bind(db)
  const descriptor = Object.getOwnPropertyDescriptor(db, 'query')
  let n = 0
  Object.defineProperty(db, 'query', {
    configurable: true,
    writable: true,
    value: (...args: unknown[]) => {
      n += 1
      return (original as (...a: unknown[]) => Promise<unknown>)(...args)
    },
  })
  try {
    await fn()
  } finally {
    if (descriptor) Object.defineProperty(db, 'query', descriptor)
    else delete (db as unknown as { query?: unknown }).query
  }
  return n
}

describe('shared graph aggregations (issue #45)', () => {
  before(seed)

  for (const [name, person, q] of splitCases) {
    it(`matches the split statements field by field: ${name}`, async () => {
      const merged = await graphFor(person, q)
      const split = await splitGraph(person, q)
      assert.deepEqual(merged.stats, split.stats)
      assert.deepEqual(
        merged.nodes.map(({ id, ...node }) => node),
        split.nodes,
      )
      assert.deepEqual(merged.signature, split.signature)
      assert.deepEqual(
        merged.nodes.map((n) => n.id),
        split.nodes.map((n) => `${n.kind}:${n.term}`),
      )
    })
  }

  it('leaves links out of the merged statement and skips it when there is no node', async () => {
    assert.ok(!statements.graph.includes('doc_terms b'), 'links must not have been folded into the aggregate statement')
    const empty = await graphFor(lula, { ...graphBase, min: 999 })
    assert.deepEqual(empty.nodes, [])
    assert.deepEqual(empty.links, [])
  })

  it('runs one statement for stats, nodes and signature, plus links', async () => {
    assert.equal(await countStatements(() => graphFor(lula, graphBase)), 2)
  })

  it('runs a single statement when the graph has no node to link', async () => {
    assert.equal(await countStatements(() => graphFor(nobody, graphBase)), 1)
  })
})

const referenceGraphSql = `
  with ${scopeCte}, ${trackedCte},
  n as materialized (select count(*)::float8 as total from tracked),
  np as materialized (select count(*)::float8 as total from about),
  term_p as materialized (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_pt, avg(d.tone)::float8 as tone
    from doc_terms t join about a on a.doc_id = t.doc_id join docs d on d.id = t.doc_id
    where not (t.term = any($6::text[]))
    group by 1, 2
  ),
  term_all as materialized (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_t
    from doc_terms t join tracked s on s.id = t.doc_id group by 1, 2
  ),
  nodes_scored as (
    select p.term, p.kind, p.c_pt::int as count, p.tone,
      ln((p.c_pt * n.total) / (np.total * a.c_t)) / ln(2) as pmi
    from term_p p join term_all a using (term, kind), n, np
    where p.c_pt >= $7 and ($5 = 'all' or p.kind = $5)
  ),
  nodes_top as (
    select term, kind, count,
      round(pmi::numeric, 2)::float8 as pmi_rounded,
      round(tone::numeric, 2)::float8 as tone_rounded,
      (case when $8 = 'pmi' then pmi * ln(1 + count) else count end) as sort_key
    from nodes_scored
    order by (case when $8 = 'pmi' then pmi * ln(1 + count) else count end) desc, term, kind
    limit $9
  ),
  signature_scored as (
    select p.term, p.kind, p.c_pt::int as count,
      ln((p.c_pt * n.total) / (np.total * a.c_t)) / ln(2) as pmi
    from term_p p join term_all a using (term, kind), n, np
    where p.c_pt >= greatest(3, np.total * 0.05)
  ),
  signature_top as (
    select term, kind, count, round(pmi::numeric, 2)::float8 as pmi
    from signature_scored
    order by pmi desc, term, kind
    limit 5
  )
  select
    (select count(*) from scope)::int as docs,
    (select count(*) from about)::int as about,
    coalesce((
      select json_agg(json_build_object('term', term, 'kind', kind, 'count', count, 'pmi', pmi_rounded, 'tone', tone_rounded)
        order by sort_key desc, term, kind)
      from nodes_top
    ), '[]'::json) as nodes,
    coalesce((
      select json_agg(json_build_object('term', term, 'kind', kind, 'count', count, 'pmi', pmi) order by pmi desc, term, kind)
      from signature_top
    ), '[]'::json) as signature`

// No order by, exactly as before #47: its row order was whatever the plan emitted.
const referenceLinksSql = `
  with ${scopeCte}
  select a.kind || ':' || a.term as s, b.kind || ':' || b.term as t, count(distinct a.doc_id)::int as count
  from doc_terms a
  join doc_terms b on a.doc_id = b.doc_id and (a.kind || ':' || a.term) < (b.kind || ':' || b.term)
  join about x on x.doc_id = a.doc_id
  where (a.kind || ':' || a.term) = any($5::text[]) and (b.kind || ':' || b.term) = any($5::text[])
  group by 1, 2 having count(distinct a.doc_id) >= 2`

const referenceRisingSql = `
  with
  recent_scope as (
    select d.id from docs d
    where d.published_at >= now() - make_interval(days => $2)
      and ($4 = 'all' or d.source = $4)
      and ($5 = 'all' or d.domain = any(string_to_array($5, ',')))
  ),
  recent_about as (
    select dp.doc_id from doc_persons dp join recent_scope s on s.id = dp.doc_id where dp.person_id = $1
  ),
  baseline_scope as (
    select d.id from docs d
    where d.published_at < now() - make_interval(days => $2)
      and d.published_at >= now() - make_interval(days => $2 + $3)
      and ($4 = 'all' or d.source = $4)
      and ($5 = 'all' or d.domain = any(string_to_array($5, ',')))
  ),
  baseline_about as (
    select dp.doc_id from doc_persons dp join baseline_scope s on s.id = dp.doc_id where dp.person_id = $1
  ),
  recent_terms as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_recent
    from doc_terms t join recent_about a on a.doc_id = t.doc_id
    where ($6 = 'all' or t.kind = $6) and not (t.term = any($7::text[]))
    group by 1, 2
  ),
  baseline_terms as (
    select t.term, t.kind, count(distinct t.doc_id)::float8 as c_baseline
    from doc_terms t join baseline_about a on a.doc_id = t.doc_id
    where ($6 = 'all' or t.kind = $6) and not (t.term = any($7::text[]))
    group by 1, 2
  )
  select r.term, r.kind,
    round((r.c_recent / $2)::numeric, 2)::float8 as count_recent,
    round((coalesce(b.c_baseline, 0) / $3)::numeric, 2)::float8 as count_baseline,
    round(((r.c_recent / $2) / ((coalesce(b.c_baseline, 0) + 1) / $3))::numeric, 2)::float8 as lift
  from recent_terms r left join baseline_terms b using (term, kind)
  where r.c_recent >= $8
  order by lift desc, term, kind
  limit $9`

// No `tone is not null`, exactly as before #47.
const referenceToneSql = `
  select p.id as person_id, d.domain as domain,
    round(avg(d.tone)::numeric, 2)::float8 as tone, count(d.tone)::int as n
  from docs d
  join doc_persons dp on dp.doc_id = d.id
  join persons p on p.id = dp.person_id
  where d.published_at >= now() - make_interval(days => $1)
    and d.domain is not null
  group by p.id, d.domain
  having count(d.tone) >= $2
  order by p.id, d.domain`

type Row = Record<string, unknown>

const referenceGraph = async (person: Person, q: GraphQuery) => {
  const exclude = nameTokens(person)
  const { domain } = resolveScope(q.domain, q.lean)
  const { rows } = await db.query<{ docs: number; about: number; nodes: Row[]; signature: Row[] }>(referenceGraphSql, [
    person.id,
    q.days,
    q.source,
    domain,
    q.kind,
    exclude,
    q.min,
    q.sort,
    q.limit,
  ])
  const { docs, about, nodes, signature } = rows[0]
  const ids = nodes.map((t) => `${t.kind}:${t.term}`)
  const links = ids.length ? await db.query<{ s: string; t: string; count: number }>(referenceLinksSql, [person.id, q.days, q.source, domain, ids]) : { rows: [] }
  return {
    stats: { docs, about },
    signature,
    nodes: nodes.map((t): Row => ({ id: `${t.kind}:${t.term}`, ...t })),
    spokes: nodes.map((t) => ({ source: `person:${person.id}`, target: `${t.kind}:${t.term}`, count: t.count })),
    pairs: links.rows.map((l) => ({ source: l.s, target: l.t, count: l.count })),
  }
}

const referenceRising = async (person: Person, q: RisingQuery) => {
  const { domain } = resolveScope(q.domain, q.lean)
  const { rows } = await db.query<Row>(referenceRisingSql, [
    person.id,
    q.days,
    q.baseline,
    q.source,
    domain,
    q.kind,
    nameTokens(person),
    q.min,
    q.limit,
  ])
  return rows
}

const referenceTone = async (q: ToneQuery) => (await db.query<Row>(referenceToneSql, [q.days, q.min])).rows

const byId = (a: { source: string; target: string }, b: { source: string; target: string }) =>
  a.source === b.source ? (a.target < b.target ? -1 : 1) : a.source < b.source ? -1 : 1

// Docs 43-45 ("coalizao" under two kinds, doc 43 shared by lula and bolsonaro) sit past 3400 days.
const sharedWide: GraphQuery = { ...graphBase, days: 3500, min: 1, limit: 200 }

const graphCases: [string, Person, GraphQuery][] = [
  ['default window', lula, graphBase],
  ['one term text under two kinds in the default window (#reforma and reforma)', lula, { ...graphBase, kind: 'all', min: 1 }],
  ['a doc shared by two persons, one term text under two kinds', lula, sharedWide],
  ['the same shared doc seen from the other person', bolsonaro, sharedWide],
  ['the shared window sorted by pmi', lula, { ...sharedWide, sort: 'pmi', limit: 10 }],
  ['kind=hashtag over the shared window', lula, { ...sharedWide, kind: 'hashtag' }],
  ['kind=word over the shared window', bolsonaro, { ...sharedWide, kind: 'word' }],
  ['toned and untoned docs mixed in one window', tarcisio, { ...graphBase, days: 365, limit: 200 }],
  ['a window whose only doc names two persons', bolsonaro, { ...graphBase, days: 365, limit: 200 }],
  ['a min floor above the shared-doc counts', lula, { ...sharedWide, min: 3 }],
  ['a source list over the shared window', lula, { ...sharedWide, source: 'rss,gnews' }],
  ['a domain filter over the shared window', lula, { ...sharedWide, domain: 'example.org' }],
  ['a person with no docs at all', nobody, sharedWide],
]

describe('count(*) matches count(distinct doc_id) in the graph path (issue #47)', () => {
  before(seed)

  for (const [name, person, q] of graphCases) {
    it(`matches the reference statement field by field: ${name}`, async () => {
      const shipped = await graphFor(person, q)
      const reference = await referenceGraph(person, q)
      assert.deepEqual(shipped.stats, reference.stats)
      assert.deepEqual(shipped.nodes, reference.nodes)
      assert.deepEqual(shipped.signature, reference.signature)
      const spokes = shipped.links.filter((l) => l.source.startsWith('person:'))
      const pairs = shipped.links.filter((l) => !l.source.startsWith('person:'))
      assert.deepEqual(spokes, reference.spokes)
      assert.deepEqual([...pairs].sort(byId), [...reference.pairs].sort(byId))
    })
  }

  it('counts a doc naming two persons once per person, and once in the shared denominator', async () => {
    // docs 43 (lula + bolsonaro), 44 (lula) and 45 (bolsonaro) all carry word:coalizao
    const l = await graphFor(lula, sharedWide)
    const b = await graphFor(bolsonaro, sharedWide)
    assert.equal(l.nodes.find((n) => n.id === 'word:coalizao')?.count, 2)
    assert.equal(b.nodes.find((n) => n.id === 'word:coalizao')?.count, 2)
    // c_t is 3, not 4: the shared doc must not enter `tracked` twice
    const { rows } = await db.query<{ c_t: number }>(
      `select count(*)::int as c_t from doc_terms t
       where t.term = 'coalizao' and t.kind = 'word'
         and exists (select 1 from doc_persons dp where dp.doc_id = t.doc_id)`,
    )
    assert.equal(rows[0].c_t, 3)
    // and the pmi the reference computes from count(distinct) is the one shipped
    const ref = await referenceGraph(lula, sharedWide)
    assert.equal(l.nodes.find((n) => n.id === 'word:coalizao')?.pmi, ref.nodes.find((n) => n.id === 'word:coalizao')?.pmi as number)
  })

  it('keeps one term text under two kinds as two nodes with their own counts', async () => {
    const g = await graphFor(lula, sharedWide)
    const nodes = g.nodes.filter((n) => n.term === 'coalizao')
    assert.deepEqual(nodes.map((n) => n.kind).sort(), ['hashtag', 'word'])
    // docs 43 and 44 carry both for lula; doc 45 is bolsonaro-only
    for (const n of nodes) assert.equal(n.count, 2, `${n.id} must count 2 docs`)
    const b = await graphFor(bolsonaro, sharedWide)
    assert.equal(b.nodes.find((n) => n.id === 'hashtag:coalizao')?.count, 2)
  })

  it('links the same term text across kinds without collapsing or double-counting', async () => {
    const g = await graphFor(lula, sharedWide)
    const pair = (s: string, t: string) => g.links.find((l) => l.source === s && l.target === t)
    // docs 43 and 44 both carry both kinds, so the pair is exactly 2 — never 4 from the shared doc
    assert.equal(pair('hashtag:coalizao', 'word:coalizao')?.count, 2)
  })

  it('breaks a (count, term) tie across kinds by kind, deterministically', async () => {
    // hashtag/word:coalizao both count 2 for lula in this window, so nothing but `kind`
    // separates them; before #47 the order was whatever the plan emitted
    const g = await graphFor(lula, sharedWide)
    const tied = g.nodes.filter((n) => n.term === 'coalizao')
    assert.deepEqual(tied.map((n) => n.kind), ['hashtag', 'word'])
    for (let i = 0; i < 5; i++) {
      assert.deepEqual((await graphFor(lula, sharedWide)).nodes.map((n) => n.id), g.nodes.map((n) => n.id))
    }
  })

  it('applies the same tiebreak to the limit, not only to the surviving order', async () => {
    // limit 1 over a window where the three coalizao kinds are the whole tie set
    const only = await graphFor(lula, { ...sharedWide, kind: 'all', min: 2, limit: 1 })
    const all = await graphFor(lula, { ...sharedWide, kind: 'all', min: 2, limit: 200 })
    assert.deepEqual(only.nodes.map((n) => n.id), all.nodes.slice(0, 1).map((n) => n.id))
  })

  it('emits the co-occurrence links ordered by (source, target), as the pre-#47 plan did', async () => {
    const pairs = (await graphFor(lula, sharedWide)).links.filter((l) => !l.source.startsWith('person:'))
    assert.ok(pairs.length > 1, 'expected several co-occurrence links in this window')
    assert.deepEqual(pairs, [...pairs].sort(byId))
    assert.ok(statements.links.includes('order by 1, 2'), 'links must pin its own order now that count(*) lets the planner hash')
  })
})


// risingFor's parser clamps days and baseline to 365 each, so docs 43-45 are out of reach here;
// the multi-kind case in this window is doc 1's #reforma alongside the word reforma.
const risingCases: [string, Person, RisingQuery][] = [
  ['default split', lula, risingBase],
  ['one term text under two kinds', lula, { ...risingBase, days: 30, baseline: 30, limit: 100 }],
  ['the widest split the parser allows', lula, { ...risingBase, days: 365, baseline: 365, limit: 100 }],
  ['a window whose only doc names two persons', bolsonaro, { ...risingBase, days: 40, baseline: 365, limit: 100 }],
  ['the other person of that shared doc', tarcisio, { ...risingBase, days: 40, baseline: 365, limit: 100 }],
  ['kind=hashtag', lula, { ...risingBase, days: 30, baseline: 30, kind: 'hashtag', limit: 100 }],
  ['a min floor', lula, { ...risingBase, days: 30, baseline: 30, min: 2, limit: 100 }],
  ['a domain filter', lula, { ...risingBase, days: 365, baseline: 365, domain: 'example.org', limit: 100 }],
  ['a person with no docs at all', nobody, risingBase],
]

describe('count(*) matches count(distinct doc_id) in the rising path (issue #47)', () => {
  before(seed)

  for (const [name, person, q] of risingCases) {
    it(`matches the reference statement row for row: ${name}`, async () => {
      const shipped = await risingFor(person, q)
      assert.deepEqual(shipped.terms, await referenceRising(person, q))
    })
  }

  it('keeps a term text present under two kinds as two rows', async () => {
    const q: RisingQuery = { ...risingBase, days: 30, baseline: 30, limit: 100 }
    const rows = (await risingFor(lula, q)).terms.filter((r) => r.term === 'reforma')
    assert.deepEqual(rows.map((r) => r.kind).sort(), ['hashtag', 'word'])
  })

  it('counts a shared doc once for each person it names', async () => {
    // doc 37 (day 35) names tarcisio and bolsonaro; it is the only bolsonaro doc under 365 days
    const q: RisingQuery = { ...risingBase, days: 40, baseline: 365, limit: 100 }
    const b = (await risingFor(bolsonaro, q)).terms.find((r) => r.term === 'alianca')
    const t = (await risingFor(tarcisio, q)).terms.find((r) => r.term === 'alianca')
    assert.equal(b?.count_recent, t?.count_recent)
    assert.equal(b?.count_recent, Number((1 / 40).toFixed(2)))
  })
})

const toneCases: [string, ToneQuery][] = [
  ['the default window and min', { days: 30, min: 3 }],
  ['min lowered to the parser floor', { days: 30, min: 1 }],
  ['a window reaching the shared toned doc', { days: 90, min: 1 }],
  ['the widest window the parser allows', { days: 365, min: 1 }],
  ['a min no group reaches', { days: 365, min: 1000 }],
  ['a window with no toned doc at all', { days: 1, min: 1 }],
]

describe('tone is not null changes nothing in the tone matrix (issue #47)', () => {
  before(seed)

  for (const [name, q] of toneCases) {
    it(`matches the reference statement row for row: ${name}`, async () => {
      assert.deepEqual((await toneFor(q)).cells, await referenceTone(q))
    })
  }

  it('keeps an untoned doc out of a group it never contributed to', async () => {
    // doc 36 is an untoned rss doc on estadao.com.br about tarcisio, alongside the three toned
    // docs 30-32 (-2, -1, 0): the filter drops the row avg/count already ignored
    const cells = (await toneFor({ days: 30, min: 3 })).cells
    assert.deepEqual(cells.find((c) => c.person_id === 'tarcisio' && c.domain === 'estadao.com.br'), {
      person_id: 'tarcisio',
      domain: 'estadao.com.br',
      tone: -1,
      n: 3,
    })
  })

  it('still drops a group whose docs are all untoned', async () => {
    // lula has no toned doc on g1.globo.com in any window
    const cells = (await toneFor({ days: 365, min: 1 })).cells
    assert.ok(!cells.some((c) => c.person_id === 'lula' && c.domain === 'g1.globo.com'))
    assert.ok(cells.some((c) => c.person_id === 'lula' && c.domain === 'gdeltproject.org'), 'lula keeps its one toned domain')
  })

  it('keeps a toned doc naming two persons in both groups', async () => {
    const cells = (await toneFor({ days: 90, min: 1 })).cells
    for (const id of ['tarcisio', 'bolsonaro']) {
      assert.deepEqual(cells.find((c) => c.person_id === id && c.domain === 'poder360.com.br'), {
        person_id: id,
        domain: 'poder360.com.br',
        tone: 0.4,
        n: 1,
      })
    }
  })

  it('leaves the domains list and the persons list untouched', async () => {
    const shipped = await toneFor({ days: 365, min: 1 })
    const reference = await referenceTone({ days: 365, min: 1 })
    assert.deepEqual(shipped.domains, [...new Set(reference.map((c) => c.domain as string))].sort())
    assert.equal(shipped.persons.length, 3)
  })
})

const testimonyScopeCte = `
  scope as (
    select d.source, d.domain, dt.score
    from doc_persons dp
    join docs d on d.id = dp.doc_id
    join doc_testimony dt on dt.doc_id = dp.doc_id and dt.person_id = dp.person_id and dt.method = $4
    where dp.person_id = $1
      and d.published_at >= now() - make_interval(days => $2)
      and ($3 = 'all' or d.source = any(string_to_array($3, ',')))
  )`

const overallSql = `
  with ${testimonyScopeCte}
  select round(avg(score)::numeric, 2)::float8 as score, count(score)::int as n from scope`

const bySourceSql = `
  with ${testimonyScopeCte}
  select source, round(avg(score)::numeric, 2)::float8 as score, count(score)::int as n
  from scope
  group by source
  having count(score) >= 1
  order by source`

const byDomainSql = `
  with ${testimonyScopeCte}
  select domain, source, round(avg(score)::numeric, 2)::float8 as score, count(score)::int as n
  from scope
  where domain is not null
  group by domain, source
  having count(score) >= $5
  order by domain, source`

const splitTestimony = async (person: Person, q: TestimonyQuery) => {
  const params = [person.id, q.days, q.source, q.method]
  const [overall, bySourceRows, byDomainRows] = await Promise.all([
    db.query<Record<string, unknown>>(overallSql, params),
    db.query<Record<string, unknown>>(bySourceSql, params),
    db.query<Record<string, unknown>>(byDomainSql, [...params, q.min]),
  ])
  return {
    method: q.method,
    overall: overall.rows[0] ?? { score: null, n: 0 },
    by_source: bySourceRows.rows,
    by_domain: byDomainRows.rows,
  }
}

const domainOf = (r: Awaited<ReturnType<typeof testimonyFor>>, domain: string) => r.by_domain.find((d) => d.domain === domain)
const sourceOf = (r: Awaited<ReturnType<typeof testimonyFor>>, source: string) => r.by_source.find((s) => s.source === source)

// Layered on the shared fixture: a second method over the same docs, so method isolation is
// asserted against rows that would otherwise land in exactly the same groups. Memoized like
// fixture.ts's own seed(), since both suites below run in one process and the extra rows would
// violate doc_testimony's primary key on a second insert.
let seeded: Promise<void> | null = null
const seedAll = () =>
  (seeded ??= (async () => {
    await seed()
    await insertTestimony('https://estadao.com.br/30', 'tarcisio', 'other', -10)
    await insertTestimony('https://example.org/35', 'tarcisio', 'other', -10)
    await insertTestimony('https://poder360.com.br/37', 'bolsonaro', 'other', 9)
  })())

const testimonyCases: [string, Person, TestimonyQuery][] = [
  ['default window', tarcisio, testimonyBase],
  ['min lowered to 1', tarcisio, { ...testimonyBase, min: 1 }],
  ['min lowered to 2', tarcisio, { ...testimonyBase, min: 2 }],
  ['min above every group', tarcisio, { ...testimonyBase, min: 1000 }],
  ['a wide window with a shared doc', tarcisio, { days: 90, source: 'all', method: 'stub', min: 1 }],
  ['the other person of the shared doc', bolsonaro, { days: 90, source: 'all', method: 'stub', min: 1 }],
  ['a single source', lula, { ...testimonyBase, source: 'gkg' }],
  ['a comma-separated source list', lula, { ...testimonyBase, source: 'gkg,gnews' }],
  ['a source the person has no docs in', lula, { ...testimonyBase, source: 'bluesky' }],
  ['a window wide enough to add an older doc', lula, { ...testimonyBase, days: 200 }],
  ['a window too narrow for any doc', lula, { ...testimonyBase, days: 1, source: 'camara' }],
  ['a second method over the same docs', tarcisio, { ...testimonyBase, method: 'other', min: 1 }],
  ['a method never inserted', tarcisio, { ...testimonyBase, method: 'never-inserted-method' }],
  ['a person with no testimony at all', nobody, testimonyBase],
  ['a person with no testimony at all, min 1', nobody, { ...testimonyBase, min: 1 }],
]

describe('shared testimony aggregations (issue #48)', () => {
  before(seedAll)

  for (const [name, person, q] of testimonyCases) {
    it(`matches the split statements field by field: ${name}`, async () => {
      assert.deepEqual(await testimonyFor(person, q), await splitTestimony(person, q))
    })
  }

  it('runs one statement for overall, by_source and by_domain', async () => {
    assert.equal(await countStatements(() => testimonyFor(tarcisio, testimonyBase)), 1)
  })

  it('keeps the response shape and the key set of every row', async () => {
    const r = await testimonyFor(tarcisio, { ...testimonyBase, min: 1 })
    assert.deepEqual(Object.keys(r).sort(), ['by_domain', 'by_source', 'method', 'overall'])
    assert.deepEqual(Object.keys(r.overall).sort(), ['n', 'score'])
    for (const row of r.by_source) assert.deepEqual(Object.keys(row).sort(), ['n', 'score', 'source'])
    for (const row of r.by_domain) assert.deepEqual(Object.keys(row).sort(), ['domain', 'n', 'score', 'source'])
  })

  it('returns numbers and nulls through json, never strings', async () => {
    const r = await testimonyFor(tarcisio, { ...testimonyBase, min: 1 })
    assert.equal(typeof r.overall.score, 'number')
    assert.equal(typeof r.overall.n, 'number')
    assert.equal(typeof r.by_source[0].score, 'number')
    assert.equal(typeof r.by_source[0].n, 'number')
    assert.equal(typeof r.by_domain[0].domain, 'string')
    const empty = await testimonyFor(lula, { ...testimonyBase, method: 'never-inserted-method' })
    assert.equal(empty.overall.score, null)
  })
})

// The asymmetries a single-statement rewrite is most likely to flatten by accident.
describe('testimony level asymmetries survive the merge (issue #48)', () => {
  before(seedAll)
  after(reseed)

  it('overall has no count floor: a single score is reported even at min 1000', async () => {
    const r = await testimonyFor(bolsonaro, { days: 90, source: 'all', method: 'stub', min: 1000 })
    assert.deepEqual(r.overall, { score: -7, n: 1 })
    assert.deepEqual(r.by_domain, [], 'min 1000 empties by_domain, and only by_domain')
    assert.deepEqual(r.by_source, [{ source: 'gdelt', score: -7, n: 1 }])
  })

  it('by_source keeps its floor of 1 and never sees the caller min', async () => {
    // oglobo.globo.com/33-34 and example.org/35 sit below the default min=3 per domain;
    // the gdelt source group still carries all six scores.
    const r = await testimonyFor(tarcisio, testimonyBase)
    assert.deepEqual(r.by_source, [{ source: 'gdelt', score: 1.33, n: 6 }])
    const high = await testimonyFor(tarcisio, { ...testimonyBase, min: 1000 })
    assert.deepEqual(high.by_source, r.by_source, 'min moves by_domain only')
  })

  it('by_source drops a group whose scores are all null, which is the floor of 1', async () => {
    // estadao.com.br/36 is the only rss doc scored for tarcisio, and its score is null
    const r = await testimonyFor(tarcisio, { ...testimonyBase, min: 1 })
    assert.equal(sourceOf(r, 'rss'), undefined)
    assert.equal(domainOf(r, 'estadao.com.br')?.n, 3, 'the null score is out of n at every level')
    assert.equal(r.overall.n, 6)
  })

  it('only by_domain uses min, and it moves nothing else', async () => {
    const atThree = await testimonyFor(tarcisio, testimonyBase)
    const atTwo = await testimonyFor(tarcisio, { ...testimonyBase, min: 2 })
    assert.deepEqual(atTwo.overall, atThree.overall)
    assert.deepEqual(atTwo.by_source, atThree.by_source)
    assert.equal(domainOf(atThree, 'oglobo.globo.com'), undefined)
    assert.deepEqual(domainOf(atTwo, 'oglobo.globo.com'), { domain: 'oglobo.globo.com', source: 'gdelt', score: 2, n: 2 })
  })

  it('never emits a null domain in by_domain, at any min, while the doc still counts elsewhere', async () => {
    // example.org/35 is stored with no domain
    for (const min of [1, 2, 3]) {
      const r = await testimonyFor(tarcisio, { ...testimonyBase, min })
      assert.ok(!r.by_domain.some((d) => d.domain === null || d.domain === undefined))
    }
    const r = await testimonyFor(tarcisio, { ...testimonyBase, min: 1 })
    assert.equal(sourceOf(r, 'gdelt')?.n, 6, 'the domain-less score is inside the source subtotal')
  })

  it('keeps a real null-domain group and the source subtotal apart, never collapsing one into the other', async () => {
    // Both rows carry domain = null in a GROUPING SETS result: the gdelt subtotal (n=6) and the
    // genuine (domain is null, gdelt) group (n=1, the -8 of example.org/35). grouping() is the
    // only thing that tells them apart.
    const r = await testimonyFor(tarcisio, { ...testimonyBase, min: 1 })
    assert.deepEqual(
      r.by_source.filter((s) => s.source === 'gdelt'),
      [{ source: 'gdelt', score: 1.33, n: 6 }],
      'exactly one gdelt row, and it is the subtotal, not the null-domain group',
    )
    const raw = await db.query<{ g_source: number; g_domain: number; source: string | null; domain: string | null; n: number }>(
      `with ${testimonyScopeCte}
       select grouping(source) as g_source, grouping(domain) as g_domain, source, domain, count(score)::int as n
       from scope group by grouping sets ((), (source), (domain, source))
       order by g_source, g_domain, source, domain`,
      [tarcisio.id, 30, 'all', 'stub'],
    )
    const nullDomain = raw.rows.filter((row) => row.domain === null)
    assert.ok(nullDomain.length >= 3, 'overall, the source subtotals and a real null-domain group all carry domain null')
    assert.deepEqual(
      nullDomain.filter((row) => row.g_domain === 0),
      [{ g_source: 0, g_domain: 0, source: 'gdelt', domain: null, n: 1 }],
    )
  })

  it('keeps methods isolated: another method over the same docs never leaks in', async () => {
    const stub = await testimonyFor(tarcisio, { ...testimonyBase, min: 1 })
    const other = await testimonyFor(tarcisio, { ...testimonyBase, method: 'other', min: 1 })
    assert.deepEqual(stub.overall, { score: 1.33, n: 6 })
    assert.deepEqual(other.overall, { score: -10, n: 2 })
    assert.deepEqual(other.by_source, [{ source: 'gdelt', score: -10, n: 2 }])
    assert.deepEqual(other.by_domain, [{ domain: 'estadao.com.br', source: 'gdelt', score: -10, n: 1 }])
  })

  it('keeps persons isolated for a doc shared by two of them', async () => {
    const wide: TestimonyQuery = { days: 90, source: 'all', method: 'stub', min: 1 }
    const t = await testimonyFor(tarcisio, wide)
    const b = await testimonyFor(bolsonaro, wide)
    assert.deepEqual(domainOf(t, 'poder360.com.br'), { domain: 'poder360.com.br', source: 'gdelt', score: 7, n: 1 })
    assert.deepEqual(domainOf(b, 'poder360.com.br'), { domain: 'poder360.com.br', source: 'gdelt', score: -7, n: 1 })
    assert.deepEqual(t.overall, { score: 2.14, n: 7 })
    assert.deepEqual(b.overall, { score: -7, n: 1 })
  })

  it('rounds the average to two decimals at every level and never touches the count', async () => {
    const r = await testimonyFor(tarcisio, { ...testimonyBase, min: 1 })
    assert.equal(r.overall.score, 1.33)
    assert.equal(sourceOf(r, 'gdelt')?.score, 1.33)
    assert.equal(domainOf(r, 'oglobo.globo.com')?.score, 2)
    assert.ok(Number.isInteger(r.overall.n))
  })

  it('orders by_source by source and by_domain by (domain, source)', async () => {
    const r = await testimonyFor(tarcisio, { days: 90, source: 'all', method: 'stub', min: 1 })
    assert.deepEqual(
      r.by_source.map((s) => s.source),
      [...r.by_source.map((s) => s.source)].sort(),
    )
    const keys = r.by_domain.map((d) => `${d.domain} ${d.source}`)
    assert.deepEqual(keys, [...keys].sort())
    assert.ok(keys.length >= 3, 'more than one domain must be in play for the ordering to mean anything')
  })

  it('keeps the empty shape for a method nobody was scored under', async () => {
    const r = await testimonyFor(tarcisio, { ...testimonyBase, method: 'never-inserted-method' })
    assert.deepEqual(r, { method: 'never-inserted-method', overall: { score: null, n: 0 }, by_source: [], by_domain: [] })
  })

  it('keeps the empty shape for a person with no scored doc at all', async () => {
    const r = await testimonyFor(nobody, testimonyBase)
    assert.deepEqual(r, { method: 'stub', overall: { score: null, n: 0 }, by_source: [], by_domain: [] })
  })

  it('answers whatever method label it is handed, without resolving or validating it', async () => {
    // The route's default method is decided outside this function (issue #35); testimonyFor
    // stays agnostic and filters doc_testimony.method on the string it is given.
    for (const method of ['stub', 'other', 'kikori:q8', 'onnx']) {
      const r = await testimonyFor(tarcisio, { ...testimonyBase, method, min: 1 })
      assert.equal(r.method, method)
    }
  })

  it('exports the merged statement, and only it, for the benchmark', () => {
    assert.equal(typeof statements.testimonySummary, 'string')
    assert.ok(statements.testimonySummary.includes('grouping sets'))
    assert.ok(!Object.keys(statements).some((k) => k.startsWith('testimony') && k !== 'testimonySummary'))
  })
})
