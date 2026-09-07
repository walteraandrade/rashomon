import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { docsFor, graphFor, risingFor, sourcesFor, type GraphQuery, type RisingQuery } from '../src/graph.js'
import { nameTokens } from '../src/extract.js'
import { parseSourceList } from '../src/query.js'
import { insertDoc, upsertPersons } from '../src/store.js'
import { persons, seed } from './fixture.js'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

const base: GraphQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 40, min: 1, sort: 'count' }
const [lula, tarcisio] = persons
const node = (g: Awaited<ReturnType<typeof graphFor>>, id: string) => g.nodes.find((n) => n.id === id)
const pmi = (cPt: number, cT: number, n: number, np: number) => Math.round(Math.log2((cPt * n) / (np * cT)) * 100) / 100

describe('graphFor', () => {
  before(seed)

  it('counts docs in the window and docs about the person', async () => {
    const g = await graphFor(lula, base)
    // days:30 also picks up docs /30-/36 (tarcisio gdelt/rss tone fixtures for issue #5; doc /37
    // sits at day 35, just outside this window) and doc /38 (gkg, about lula, issue #8's
    // press-vs-network fixture), widening both the person-agnostic scope (docs 13 -> 14) and about (4 -> 5)
    assert.equal(g.stats.docs, 14)
    assert.equal(g.stats.about, 5)
  })

  it('widens with the window', async () => {
    // 365 days also picks up docs /17-/19 (estabilidade fiscal, day31/35/50), added for risingFor's tests
    const g = await graphFor(lula, { ...base, days: 365 })
    assert.equal(g.stats.docs, 19)
    assert.equal(g.stats.about, 9)
  })

  it('never lists the person name as a term', async () => {
    const g = await graphFor(lula, base)
    assert.ok(!g.nodes.some((n) => n.term === 'lula'))
  })

  it('computes pmi as log2 lift against the whole window', async () => {
    const g = await graphFor(lula, base)
    assert.equal(node(g, 'word:reforma')?.pmi, pmi(3, 3, 14, 5))
    assert.equal(node(g, 'word:eleicao')?.pmi, pmi(1, 1, 14, 5))
    assert.equal(node(g, 'word:congresso'), undefined)
  })

  it('carries hashtags as their own kind and filters by kind', async () => {
    const all = await graphFor(lula, base)
    assert.equal(node(all, 'hashtag:reforma')?.count, 1)
    const only = await graphFor(lula, { ...base, kind: 'hashtag' })
    assert.ok(only.nodes.length > 0)
    assert.ok(only.nodes.every((n) => n.kind === 'hashtag'))
  })

  it('averages GDELT tone per term and leaves it null otherwise', async () => {
    const g = await graphFor(tarcisio, base)
    assert.equal(node(g, 'word:rodovia')?.tone, -1.5)
    assert.equal(node(g, 'word:eleicao')?.tone, null)
  })

  it('filters by source and by domain', async () => {
    const bs = await graphFor(lula, { ...base, source: 'bluesky' })
    assert.equal(bs.stats.about, 1)
    const g1 = await graphFor(lula, { ...base, domain: 'g1.globo.com' })
    assert.equal(g1.stats.about, 1)
    assert.equal(g1.stats.docs, 1)
  })

  it('honours min and limit', async () => {
    const g = await graphFor(lula, { ...base, min: 2 })
    assert.deepEqual(g.nodes.map((n) => n.term).sort(), ['reforma', 'tributaria'])
    const one = await graphFor(lula, { ...base, limit: 1 })
    assert.equal(one.nodes.length, 1)
  })

  it('links every term to the person and co-occurring terms to each other', async () => {
    const g = await graphFor(lula, base)
    const spokes = g.links.filter((l) => l.source === 'person:lula')
    assert.equal(spokes.length, g.nodes.length)
    const pair = g.links.find((l) => l.source === 'word:reforma' && l.target === 'word:tributaria')
    assert.equal(pair?.count, 2)
    assert.ok(!g.links.some((l) => l.source === 'word:disputam'), 'pairs seen in a single doc are not linked')
  })

  it('returns an empty graph for a person without docs', async () => {
    const g = await graphFor({ id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }, base)
    assert.equal(g.stats.about, 0)
    assert.deepEqual(g.nodes, [])
  })

  it('signature: top terms meet the count floor of max(3, 5% of about)', async () => {
    const g = await graphFor(lula, base)
    assert.deepEqual(g.signature, [{ term: 'reforma', kind: 'word', count: 3, pmi: pmi(3, 3, 14, 5) }])
  })

  it('signature: never lists the person name as a term', async () => {
    const g = await graphFor(lula, base)
    assert.ok(!g.signature.some((s) => s.term === 'lula'))
  })

  it('signature: ignores kind, min, limit and sort', async () => {
    const a = await graphFor(lula, base)
    const b = await graphFor(lula, { ...base, kind: 'hashtag', min: 10, limit: 1, sort: 'pmi' })
    assert.deepEqual(a.signature, b.signature)
  })

  it('signature: empty for a person without docs', async () => {
    const g = await graphFor({ id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }, base)
    assert.deepEqual(g.signature, [])
  })

  it('signature: orders by pmi desc, ties by term ascending', async () => {
    const g = await graphFor(lula, { ...base, days: 1000 })
    // docs /17-/19 add "estabilidade"/"fiscal" (3 mentions each, about-lula only), tying with the others;
    // n is 25 (was 24), widened by doc /38 (gkg, about lula, issue #8's press-vs-network fixture),
    // which also names lula, so np is 15 (was 14)
    const tie = pmi(3, 3, 25, 15)
    assert.deepEqual(g.signature, [
      { term: 'desemprego', kind: 'word', count: 3, pmi: tie },
      { term: 'estabilidade', kind: 'word', count: 3, pmi: tie },
      { term: 'fiscal', kind: 'word', count: 3, pmi: tie },
      { term: 'inflacao', kind: 'word', count: 3, pmi: tie },
      { term: 'reforma', kind: 'word', count: 3, pmi: tie },
    ])
  })
})

describe('multi-source filtering (issue #8)', () => {
  before(seed)

  it('AC1: a comma-separated list counts only docs whose source is in the list', async () => {
    const g = await graphFor(lula, { ...base, source: 'gnews,rss,gkg' })
    // hand-counted from the fixture: within the default 30-day window, gnews has docs /1,/6
    // (about lula) and /3 (not about lula); rss has /4 (not about lula), /7, /36 (about tarcisio);
    // gkg has /38 (about lula) -> 7 docs in scope, 4 about lula (/1, /6, /7, /38)
    assert.equal(g.stats.docs, 7)
    assert.equal(g.stats.about, 4)
  })

  it('AC1: sourcesFor and docsFor agree with the same hand-counted scope', async () => {
    const rows = await sourcesFor(lula, { ...base, source: 'gnews,rss,gkg' })
    assert.equal(rows.reduce((acc, r) => acc + r.docs, 0), 4)
    const { total } = await docsFor(lula, { term: '', kind: 'all', days: 30, source: 'gnews,rss,gkg', domain: 'all', lean: 'all', limit: 50, offset: 0 })
    assert.equal(total, 4)
  })

  it('AC2: an unknown token is silently dropped, same result as the valid token alone', async () => {
    const withBogus = await graphFor(lula, { ...base, source: 'gnews,bogus' })
    const gnewsOnly = await graphFor(lula, { ...base, source: 'gnews' })
    assert.deepEqual(withBogus, gnewsOnly)
  })

  it('AC3: every token invalid normalizes (via parseSourceList) to "all"', async () => {
    const normalized = await graphFor(lula, { ...base, source: parseSourceList('bogus1,bogus2') })
    const all = await graphFor(lula, { ...base, source: 'all' })
    assert.deepEqual(normalized, all)
  })

  it('AC4: an empty source normalizes (via parseSourceList) to "all"', async () => {
    const normalized = await graphFor(lula, { ...base, source: parseSourceList('') })
    const all = await graphFor(lula, { ...base, source: 'all' })
    assert.deepEqual(normalized, all)
  })

  it('AC5: a single valid token behaves exactly like before this change', async () => {
    const bs = await graphFor(lula, { ...base, source: 'bluesky' })
    assert.equal(bs.stats.about, 1)
  })

  it('AC7: mixing a GDELT and a non-GDELT source yields tone only for terms carried by the gkg doc', async () => {
    const g = await graphFor(lula, { ...base, source: 'gnews,rss,gkg' })
    // "parceria" only appears in doc /38 (gkg, tone 0.6); "reforma" only appears in gnews/rss docs
    assert.equal(g.nodes.find((n) => n.term === 'parceria')?.tone, 0.6)
    assert.equal(g.nodes.find((n) => n.term === 'reforma')?.tone, null)
  })

  it('AC7: source without gkg never surfaces a tone', async () => {
    const g = await graphFor(lula, { ...base, source: 'gnews,rss' })
    assert.equal(g.nodes.find((n) => n.term === 'reforma')?.tone, null)
  })
})

describe('senado source (issue #25)', () => {
  before(seed)

  it('AC8: source=senado for a person with no senado docs returns an empty, stats.docs===0 graph', async () => {
    const g = await graphFor(tarcisio, { ...base, source: 'senado' })
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
    const g = await graphFor(alcolumbre, { ...base, days: 3300, source: 'senado' })
    assert.equal(g.stats.about, 1)
    assert.ok(g.nodes.some((n) => n.term === 'soberania'))
    assert.equal(g.nodes.find((n) => n.term === 'soberania')?.tone, null)
  })
})

describe('sourcesFor', () => {
  before(seed)

  it('lists outlets that mention the person with doc counts and tone', async () => {
    const rows = await sourcesFor(tarcisio, base)
    const folha = rows.find((r) => r.domain === 'folha.uol.com.br')
    assert.equal(folha?.docs, 1)
    assert.equal(folha?.tone, -1.5)
    assert.equal(folha?.tone_n, 1)
    const bsky = rows.find((r) => r.source === 'bluesky')
    assert.equal(bsky?.domain, 'ana.bsky.social')
    assert.equal(bsky?.tone, null)
  })
})

describe('risingFor', () => {
  before(seed)

  // reforma/tributaria/anuncia/disputam/eleicao/tarcisio/hashtag:reforma/defende all sit in the
  // last-7-days recent window against the 8-37-day-ago baseline (default days:7, baseline:30);
  // "estabilidade fiscal" (docs /17-/19, day31/day35/day50) instead lands entirely in the baseline,
  // which is why it never appears at these default windows (see AC5 below).
  const risingBase: RisingQuery = { days: 7, baseline: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 20, min: 1 }
  const rnode = (r: Awaited<ReturnType<typeof risingFor>>, id: string) => r.terms.find((t) => `${t.kind}:${t.term}` === id)
  const rate = (raw: number, span: number) => Math.round((raw / span) * 100) / 100
  const lift = (cRecent: number, days: number, cBaseline: number, baseline: number) =>
    Math.round(((cRecent / days) / ((cBaseline + 1) / baseline)) * 100) / 100

  it('AC2: sorts terms by lift desc, ties by term', async () => {
    const r = await risingFor(lula, risingBase)
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
  })

  it('AC5: a term absent from the baseline outranks a term present in it at a comparable recent rate', async () => {
    const r = await risingFor(lula, risingBase)
    // "anuncia" and "defende" both have exactly 1 recent-window doc; "anuncia" has none in the
    // baseline, "defende" has 1 (doc /8, day35's "estabilidade" text also carries "defende")
    const anuncia = rnode(r, 'word:anuncia')
    const defende = rnode(r, 'word:defende')
    assert.equal(anuncia?.count_recent, defende?.count_recent)
    assert.equal(defende?.count_baseline, rate(1, 30))
    assert.ok((anuncia?.lift ?? 0) > (defende?.lift ?? 0))
  })

  it('AC6: a term with an unchanged daily rate has lift exactly 1', async () => {
    const r = await risingFor(lula, { ...risingBase, days: 40, baseline: 40 })
    // "estabilidade" has 2 mentions in the last 40 days (day31, day35) and 1 in the 40 days before (day50)
    assert.equal(rnode(r, 'word:estabilidade')?.lift, 1)
  })

  it('AC7: min filters on the raw recent count', async () => {
    const at2 = await risingFor(lula, { ...risingBase, min: 2 })
    assert.ok(rnode(at2, 'word:tributaria'))
    const at3 = await risingFor(lula, { ...risingBase, min: 3 })
    assert.equal(rnode(at3, 'word:tributaria'), undefined)
  })

  it('AC8: never lists the person name as a rising term', async () => {
    const excluded = new Set(nameTokens(lula))
    const r = await risingFor(lula, { ...risingBase, days: 2000, baseline: 2000 })
    assert.ok(!r.terms.some((t) => excluded.has(t.term)))
  })

  it('AC9: kind, source and domain filter both windows identically', async () => {
    const hashtagOnly = await risingFor(lula, { ...risingBase, kind: 'hashtag' })
    assert.ok(hashtagOnly.terms.length > 0)
    assert.ok(hashtagOnly.terms.every((t) => t.kind === 'hashtag'))

    const bluesky = await risingFor(lula, { ...risingBase, source: 'bluesky' })
    assert.ok(bluesky.terms.some((t) => t.term === 'disputam'))
    assert.ok(!bluesky.terms.some((t) => t.term === 'reforma'))

    const domainScoped = await risingFor(lula, { ...risingBase, domain: 'example.org' })
    assert.ok(!domainScoped.terms.some((t) => t.term === 'anuncia'), 'anuncia only appears on g1.globo.com')
  })

  it('AC10: returns an empty terms array for a person without docs', async () => {
    const r = await risingFor({ id: 'nobody', name: 'Nobody', aliases: ['Nobody'] }, risingBase)
    assert.deepEqual(r, { days: 7, baseline: 30, terms: [], outlets: [] })
  })

  it('AC10: returns an empty terms array for an empty recent window', async () => {
    const r = await risingFor(lula, { ...risingBase, days: 1 })
    assert.deepEqual(r.terms, [])
  })

  it('AC11: limit clamps the result size', async () => {
    const r = await risingFor(lula, { ...risingBase, limit: 1 })
    assert.equal(r.terms.length, 1)
    assert.equal(r.terms[0].term, 'reforma')
  })
})
