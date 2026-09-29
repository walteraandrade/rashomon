import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { agendaFor, comentionFor, docsFor, graphFor, risingFor, sourcesFor, timelineFor, toneFor, weekFor } from '../src/graph.js'
import { addDays, brtDate, brtMidnightUtc, DAYS, mondayOf, parseAgendaQuery, parseComentionQuery, parseDocsQuery, parseQuery, parseRisingQuery, parseTestimonyQuery, parseTimelineQuery, parseToneQuery, parseWeekQuery } from '../src/query.js'
import { methods } from '../src/scorers/index.js'
import { app, withSeedFields } from '../src/server.js'
import { insertDocP, upsertPersonsP } from '../src/store.js'
import { withEnv } from './env.js'
import { futureDoc, insertTestimony, persons, reseed, seed, seedCandidates } from './fixture.js'
import './close.js'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Person } from '../src/types.js'
import personsSeed from '../seed.json' with { type: 'json' }

// The Hono routes in src/server.ts, through app.request(): status codes, error shapes, and
// that each route answers exactly what its *For function answers for the parsed query. The
// scoring itself is in test/graph.test.ts and the parsers in test/query.test.ts; Cache-Control
// is in test/cache.test.ts and the security headers in test/security-headers-acceptance.test.ts.

const [lula, tarcisio, bolsonaro] = persons
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const brtYmd = (value: Date | string) => new Date(value).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

type Overall = { method: string; overall: { score: number | null; n: number } }
const testimony = async (qs = '') => {
  const res = await app.request(`/api/people/tarcisio/testimony${qs}`)
  assert.equal(res.status, 200)
  return (await res.json()) as Overall & { by_source: unknown; by_domain: { domain: string }[] }
}

describe('the routes answer their *For functions with the default parser (issue #21 AC14)', () => {
  before(seed)

  it('graph, sources, docs, timeline, rising, tone, agenda and people', async () => {
    const id = 'tarcisio'
    const [graphRes, sourcesRes, docsRes, timelineRes, weekRes, risingRes, toneRes, agendaRes, peopleRes] = await Promise.all([
      app.request(`/api/people/${id}/graph`),
      app.request(`/api/people/${id}/sources`),
      app.request(`/api/people/${id}/docs`),
      app.request(`/api/people/${id}/timeline`),
      app.request(`/api/people/${id}/week`),
      app.request(`/api/people/${id}/rising`),
      app.request(`/api/tone`),
      app.request(`/api/agenda`),
      app.request(`/api/people`),
    ])
    const [graphBody, sourcesBody, docsBody, timelineBody, weekBody, risingBody, toneBody, agendaBody, peopleBody] = await Promise.all([
      graphRes.json(),
      sourcesRes.json(),
      docsRes.json(),
      timelineRes.json(),
      weekRes.json(),
      risingRes.json(),
      toneRes.json(),
      agendaRes.json(),
      peopleRes.json(),
    ])

    const person = { id: tarcisio.id, name: tarcisio.name, aliases: tarcisio.aliases }
    assert.deepEqual(JSON.parse(JSON.stringify(await graphFor(person, parseQuery({})))), graphBody)
    assert.deepEqual(JSON.parse(JSON.stringify(await sourcesFor(person, parseQuery({})))), sourcesBody)
    assert.deepEqual(JSON.parse(JSON.stringify(await docsFor(person, parseDocsQuery({})))), docsBody)
    // timelineFor buckets off now(), so a fresh direct call and the earlier HTTP call can land
    // on different millisecond boundaries; shapes/counts are what must be byte-identical
    const directTimeline = await timelineFor(person, parseTimelineQuery({}))
    assert.deepEqual(
      directTimeline.map((b) => b.count),
      (timelineBody as { count: number }[]).map((b) => b.count),
    )
    assert.equal(directTimeline.length, (timelineBody as unknown[]).length)
    const directWeek = await weekFor(person, parseWeekQuery({}))
    assert.deepEqual(JSON.parse(JSON.stringify(directWeek)), weekBody)
    assert.deepEqual(JSON.parse(JSON.stringify(await risingFor(person, parseRisingQuery({})))), risingBody)
    assert.deepEqual(JSON.parse(JSON.stringify(await toneFor(parseToneQuery({})))), toneBody)
    assert.deepEqual(JSON.parse(JSON.stringify(await agendaFor(parseAgendaQuery({})))), agendaBody)
    const { rows } = await db.query<Person>(`select id, name, aliases from persons order by name`)
    assert.deepEqual(JSON.parse(JSON.stringify(rows.map((r) => withSeedFields(r)))), peopleBody)
  })

  it('/api/people/:id/graph stats are the fixture literals test/graph.test.ts pins', async () => {
    const res = await app.request('/api/people/lula/graph')
    const body = (await res.json()) as { stats: { docs: number; about: number } }
    assert.equal(body.stats.docs, 16)
    assert.equal(body.stats.about, 7)
  })

  it('/api/tone matches toneFor and the fixture literal', async () => {
    const res = await app.request('/api/tone')
    const body = (await res.json()) as { cells: { person_id: string; domain: string; tone: number; n: number }[] }
    const cell = body.cells.find((c) => c.person_id === 'tarcisio' && c.domain === 'estadao.com.br')
    assert.deepEqual(cell, { person_id: 'tarcisio', domain: 'estadao.com.br', tone: -1, n: 3 })
    assert.deepEqual(JSON.parse(JSON.stringify(await toneFor({ days: 30, min: 3 }))), body)
  })

  it('/api/agenda matches agendaFor and the fixture literal', async () => {
    // min=1 is a MINS member, so it survives parseAgendaQuery's snap unchanged
    const res = await app.request('/api/agenda?days=30&min=1')
    const body = (await res.json()) as { cells: { person_id: string; domain: string; docs: number; share: number }[] }
    const cell = body.cells.find((c) => c.person_id === 'tarcisio' && c.domain === 'estadao.com.br')
    assert.deepEqual(cell, { person_id: 'tarcisio', domain: 'estadao.com.br', docs: 4, share: 1 })
    assert.deepEqual(JSON.parse(JSON.stringify(await agendaFor({ days: 30, source: 'all', min: 1, limit: 30 }))), body)
  })

  it('GET /api/agenda with no query string is byte-identical to agendaFor(parseAgendaQuery({})) (issue #208 AC11)', async () => {
    const res = await app.request('/api/agenda')
    const body = await res.json()
    assert.deepEqual(JSON.parse(JSON.stringify(await agendaFor(parseAgendaQuery({})))), body)
  })

  // Issue #108: 'theme' left the recognized kind set, so kind=theme must be a plain
  // unrecognized token on every route, never a route error.
  it('GET /graph, /docs, /rising and /timeline?kind=theme all still return 200', async () => {
    const paths = [
      '/api/people/lula/graph?kind=theme',
      '/api/people/lula/docs?kind=theme',
      '/api/people/lula/rising?kind=theme',
      '/api/people/lula/timeline?term=reforma&kind=theme',
    ]
    for (const path of paths) {
      const res = await app.request(path)
      assert.equal(res.status, 200, `${path} must return 200`)
    }
  })

  it('GET /graph?source=senado for a person with zero senado docs returns the empty, stats.docs===0 shape', async () => {
    const res = await app.request('/api/people/lula/graph?source=senado&days=365')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Awaited<ReturnType<typeof graphFor>>
    assert.deepEqual(body.nodes, [])
    assert.deepEqual(body.links, [])
    assert.deepEqual(body.signature, [])
    assert.equal(body.stats.docs, 0)
  })
})

describe('/rising default limit is 40, not 20', () => {
  before(seed)

  it('a wide window with more than 20 matching terms and no limit param returns more than 20', async () => {
    const res = await app.request('/api/people/lula/rising?days=365&min=1')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Awaited<ReturnType<typeof risingFor>>
    assert.ok(body.terms.length > 20, `expected more than 20 terms, got ${body.terms.length}`)
    assert.ok(body.terms.length <= 40)
  })
})

describe('GET /api/people/:id/testimony (issue #21)', () => {
  before(seed)

  it('an unknown id returns 404 with { error: "person not found" }, the same shape as every other /:id/* route', async () => {
    const res = await app.request('/api/people/does-not-exist/testimony')
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'person not found' })
  })

  it('wires the querystring through parseTestimonyQuery end to end', async () => {
    const body = await testimony('?method=stub&min=2')
    // oglobo.globo.com/gdelt clears min=2 (scores 5, -1 -> avg 2, n=2), the same hand
    // computation test/graph.test.ts makes, this time reached purely through the HTTP layer.
    // by_domain has no ORDER BY in the SQL, so compare sorted-by-domain, not array order.
    assert.equal(body.method, 'stub')
    assert.deepEqual(body.overall, { score: 1.33, n: 6 })
    assert.deepEqual(body.by_source, [{ source: 'gdelt', score: 1.33, n: 6 }])
    assert.deepEqual(
      [...body.by_domain].sort((a, b) => a.domain.localeCompare(b.domain)),
      [
        { domain: 'estadao.com.br', source: 'gdelt', score: 4, n: 3 },
        { domain: 'oglobo.globo.com', source: 'gdelt', score: 2, n: 2 },
      ],
    )
  })
})

describe('GET /api/people/:id/week (issue #147)', () => {
  before(async () => {
    await seed()
    // Two hashtag-only mentions dated today: no literal word form, so they never compete with
    // the day1 word terms, but they give kind=all a term on a day kind=word leaves empty --
    // the control a dropped `kind` parameter needs to be caught.
    await insertDocP(
      { source: 'gnews', uri: 'https://g1.globo.com/week-kind-a', text: 'Lula é só isso #planalto', publishedAt: new Date().toISOString(), domain: 'g1.globo.com' },
      persons,
    )
    await insertDocP(
      { source: 'gnews', uri: 'https://g1.globo.com/week-kind-b', text: 'Lula outra vez isso #planalto', publishedAt: new Date().toISOString(), domain: 'g1.globo.com' },
      persons,
    )
  })
  after(reseed)

  it('GET /api/people/nobody/week is the same 404', async () => {
    const res = await app.request('/api/people/nobody/week')
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'person not found' })
  })

  it('wires the querystring through parseWeekQuery end to end', async () => {
    const res = await app.request('/api/people/lula/week?days=30&limit=1&kind=word&source=gnews')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Awaited<ReturnType<typeof weekFor>>
    const person = { id: lula.id, name: lula.name, aliases: lula.aliases }
    const expected = await weekFor(person, parseWeekQuery({ days: '30', limit: '1', kind: 'word', source: 'gnews' }))
    assert.deepEqual(JSON.parse(JSON.stringify(expected)), body)
    // days=30 must reach the response's own `days` field, and 30 daily buckets back it up.
    assert.equal(body.days, 30)
    assert.equal(body.buckets.length, 30)
    // Control: limit actually reaches weekFor. lula's gnews word terms overflow limit=1 in at
    // least one bucket, so raising it to 8 must change what the route returns.
    const wider = await app.request('/api/people/lula/week?days=30&limit=8&kind=word&source=gnews')
    const widerBody = await wider.json()
    assert.notDeepEqual(widerBody, body)
    // Control: kind actually reaches weekFor. Today's bucket carries only the hashtag-only
    // '#planalto' mentions, so dropping kind to 'all' must surface a term there kind=word hides.
    const allKinds = await app.request('/api/people/lula/week?days=30&limit=1&source=gnews')
    const allKindsBody = await allKinds.json()
    assert.notDeepEqual(allKindsBody, body)
  })
})

// Rows under real scorer labels, layered once on the fixture for the two suites below: the
// kikori label carries a `:`, which the method parser used to reject, silently answering with
// the placeholder `onnx` rows; and the route's default must resolve through the same `methods`
// map pnpm score uses (issue #35), not the retired `onnx` literal.
let labelled: Promise<void> | null = null
const seedLabels = () =>
  (labelled ??= (async () => {
    await seed()
    await insertTestimony('https://estadao.com.br/30', 'tarcisio', 'kikori:q8', 1)
    await insertTestimony('https://estadao.com.br/31', 'tarcisio', 'kikori:q8', 3)
    await insertTestimony('https://estadao.com.br/32', 'tarcisio', 'kikori:fp32', 8)
    await insertTestimony('https://estadao.com.br/30', 'tarcisio', 'onnx', -9)
  })())

describe('GET /api/people/:id/testimony with a kikori method label', () => {
  before(seedLabels)

  it('keeps kikori:q8 and answers from its rows only', async () => {
    const body = await testimony('?method=kikori:q8')
    assert.equal(body.method, 'kikori:q8')
    assert.deepEqual(body.overall, { score: 2, n: 2 })
  })

  it('keeps kikori:fp32 and never mixes it with the q8 or onnx rows', async () => {
    const body = await testimony('?method=kikori:fp32')
    assert.equal(body.method, 'kikori:fp32')
    assert.deepEqual(body.overall, { score: 8, n: 1 })
  })

  it('still answers the placeholder onnx rows when onnx is requested', async () => {
    const body = await testimony('?method=onnx')
    assert.equal(body.method, 'onnx')
    assert.deepEqual(body.overall, { score: -9, n: 1 })
  })

  it('falls back to the kikori default for a method outside the charset', async () => {
    const body = await testimony('?method=kikori%20q8!')
    assert.equal(body.method, 'kikori:q8')
    assert.deepEqual(body.overall, { score: 2, n: 2 })
  })
})

// TESTIMONY_REVISION is cleared too: once set it appends a third segment to the label
// (issue #67), and every expectation here is about the unversioned one.
const withDtype = (value: string | undefined, run: () => void | Promise<void>) =>
  withEnv({ TESTIMONY_DTYPE: value, TESTIMONY_REVISION: undefined }, run)

describe('testimony default method (issue #35)', () => {
  before(seedLabels)
  after(reseed)

  it('with no ?method and no TESTIMONY_DTYPE, the route resolves to kikori:q8, the same label pnpm score writes by default', async () =>
    withDtype(undefined, async () => {
      assert.equal(methods.onnx(), 'kikori:q8', 'sanity: the methods map itself must default to kikori:q8')
      const body = await testimony()
      assert.equal(body.method, 'kikori:q8')
      assert.deepEqual(body.overall, { score: 2, n: 2 }, 'reads the kikori:q8 rows, not the placeholder onnx ones')
    }))

  it('TESTIMONY_DTYPE=fp32 moves the default to kikori:fp32, matching what pnpm score would write under the same env', async () =>
    withDtype('fp32', async () => {
      assert.equal(methods.onnx(), 'kikori:fp32')
      const body = await testimony()
      assert.equal(body.method, 'kikori:fp32')
      assert.deepEqual(body.overall, { score: 8, n: 1 })
    }))

  it('an explicit ?method still wins over the resolved default, in any env', async () =>
    withDtype('fp32', async () => {
      assert.equal((await testimony('?method=stub')).method, 'stub')
      const onnx = await testimony('?method=onnx')
      assert.equal(onnx.method, 'onnx')
      assert.deepEqual(onnx.overall, { score: -9, n: 1 }, 'the retired placeholder rows are kept and stay reachable by name')
    }))

  it('parseTestimonyQuery resolves the same default directly, without going through HTTP', async () => {
    await withDtype(undefined, () => assert.equal(parseTestimonyQuery({}).method, 'kikori:q8'))
    await withDtype('fp32', () => assert.equal(parseTestimonyQuery({}).method, 'kikori:fp32'))
  })
})

// `testimony=1` on GET /api/people/:id/graph: the per-term kikori mean (docs in `about` that
// carry the term) plus the person's own mean over the same scope, both under the same label
// /testimony would answer with. Off by default, so the existing response shape is untouched.
describe('GET /graph?testimony=1', () => {
  before(seed)

  const graph = async (qs: string) => {
    const res = await app.request(`/api/people/tarcisio/graph?${qs}`)
    assert.equal(res.status, 200)
    return res.json()
  }

  it('is off by default: no node and no stats carries a testimony field', async () => {
    const g = await graph('days=30')
    assert.ok(g.nodes.length > 0)
    for (const n of g.nodes) assert.equal('testimony' in n, false)
    assert.equal('testimony' in g.stats, false)
  })

  it('parseQuery leaves method null unless testimony=1, then resolves the label like /testimony does', () => {
    assert.equal(parseQuery({}).method, null)
    assert.equal(parseQuery({ testimony: '1', method: 'stub' }).method, 'stub')
    assert.equal(parseQuery({ testimony: '1', method: 'bad label!' }).method, parseQuery({ testimony: '1' }).method)
    assert.equal(parseQuery({ testimony: 'yes', method: 'stub' }).method, null)
  })

  it('averages the stub scores of the docs behind each term and the person over the same scope', async () => {
    const g = await graph('days=30&testimony=1&method=stub&limit=200&min=1')
    // Tarcísio's scored docs in the window: 30 (4), 31 (6), 32 (2), 33 (5), 34 (-1), 35 (-8); 36 is null.
    assert.deepEqual(g.stats.testimony, { method: 'stub', score: 1.33, n: 6 })
    const by = (term: string) => g.nodes.find((n: { term: string }) => n.term === term)
    assert.deepEqual(by('geopolitica').testimony, { score: 4, n: 3 }, 'docs 30, 31, 32')
    assert.deepEqual(by('commodities').testimony, { score: 2, n: 2 }, 'docs 33, 34')
    assert.deepEqual(by('portuaria').testimony, { score: -8, n: 1 }, 'doc 35')
    const embaixadores = by('embaixadores')
    assert.ok(embaixadores, 'doc 36 is in the recorte')
    assert.equal(embaixadores.testimony, null, 'its only doc has a null score, so the term has no testimony')
  })

  it('an unscored label answers nulls, not an error', async () => {
    const g = await graph('days=30&testimony=1&method=nobody:ever')
    assert.deepEqual(g.stats.testimony, { method: 'nobody:ever', score: null, n: 0 })
    for (const n of g.nodes) assert.equal(n.testimony, null)
  })

  it('the person mean follows the domain filter, unlike /testimony', async () => {
    const g = await graph('days=30&testimony=1&method=stub&domain=estadao.com.br')
    assert.deepEqual(g.stats.testimony, { method: 'stub', score: 4, n: 3 })
  })
})

// `testimony=1` on GET /api/people/:id/week: the day's kikori mean, mirroring /graph's own flag.
describe('GET /week?testimony=1 (issue #150)', () => {
  before(seed)

  const week = async (qs: string) => {
    const res = await app.request(`/api/people/tarcisio/week?${qs}`)
    assert.equal(res.status, 200)
    return res.json()
  }
  const bucketAt = (body: { buckets: { start: string; testimony?: { score: number; n: number } | null }[] }, day: string) =>
    body.buckets.find((b) => brtYmd(b.start) === day)!

  it('averages the stub scores of the docs behind each day', async () => {
    const body = await week('days=30&testimony=1&method=stub')
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
    assert.deepEqual(bucketAt(body, brtYmd(daysAgo(7))).testimony, { score: 6, n: 1 })
    assert.deepEqual(bucketAt(body, brtYmd(daysAgo(6))).testimony, { score: 4, n: 1 })
  })

  it('no bucket carries a testimony key across query-parameter combinations when the flag is absent', async () => {
    const qs = ['days=30', 'days=30&source=gdelt', 'days=30&domain=estadao.com.br', 'days=30&lean=right', 'days=30&kind=word', 'days=30&limit=40']
    for (const q of qs) {
      const body = await week(q)
      for (const b of body.buckets) assert.equal('testimony' in b, false)
    }
  })

  it('an unscored method answers a 200 with testimony null on every bucket, not a 4xx', async () => {
    const res = await app.request('/api/people/tarcisio/week?days=30&testimony=1&method=nobody:ever')
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.buckets.length, 30)
    for (const b of body.buckets) assert.equal(b.testimony, null)
  })
})

describe('GET /api/compare (issue #93)', () => {
  before(seed)

  it('returns 200 with a body of exactly { days, a, b, terms } — no links/signature/nodes/outlets', async () => {
    const res = await app.request('/api/compare?a=lula&b=bolsonaro')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>
    assert.deepEqual(Object.keys(body).sort(), ['a', 'b', 'days', 'terms'])
    assert.ok(!('links' in (body.a as object)))
  })

  it('a.person and b.person are each { id, name, aliases }, matching the persons row', async () => {
    const res = await app.request('/api/compare?a=lula&b=bolsonaro')
    const body = (await res.json()) as { a: { person: unknown }; b: { person: unknown } }
    assert.deepEqual(body.a.person, { id: lula.id, name: lula.name, aliases: lula.aliases })
    assert.deepEqual(body.b.person, { id: bolsonaro.id, name: bolsonaro.name, aliases: bolsonaro.aliases })
  })

  it('an unknown a, an unknown b, or both omitted return 404 with { error: "person not found" }', async () => {
    for (const url of ['/api/compare?a=nobody&b=lula', '/api/compare?a=lula&b=nobody', '/api/compare']) {
      const res = await app.request(url)
      assert.equal(res.status, 404, url)
      assert.deepEqual(await res.json(), { error: 'person not found' })
    }
  })

  it('bridges=1 adds a bridge field to every term; omitted, the field is absent (issue #219)', async () => {
    const res = await app.request('/api/compare?a=lula&b=tarcisio&bridges=1')
    const body = (await res.json()) as { terms: { bridge?: number }[] }
    assert.ok(body.terms.length > 0)
    for (const t of body.terms) assert.equal(typeof t.bridge, 'number')
    const plain = await app.request('/api/compare?a=lula&b=tarcisio')
    const plainBody = (await plain.json()) as { terms: { bridge?: number }[] }
    for (const t of plainBody.terms) assert.ok(!('bridge' in t))
  })

  it('/api/compare/bridges scores only the ids it is given, dropping malformed ones', async () => {
    const res = await app.request('/api/compare/bridges?a=lula&b=tarcisio&days=4325&domain=comparebridge.example&ids=word:pontecompare,word:exclusivolulax,bogus:x,nocolon')
    assert.equal(res.status, 200)
    const body = (await res.json()) as { bridges: Record<string, number> }
    assert.deepEqual(Object.keys(body.bridges).sort(), ['word:exclusivolulax', 'word:pontecompare'])
    const unknown = await app.request('/api/compare/bridges?a=nobody&b=lula&ids=word:x')
    assert.equal(unknown.status, 404)
  })

  it('/api/people/:id/lenses/bridges answers { bridges }, empty when no ids survive parsing', async () => {
    const res = await app.request('/api/people/lula/lenses/bridges?ids=nope')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { bridges: {} })
  })
})

describe('GET /api/comention (issue #207)', () => {
  before(seed)

  it('matches comentionFor with the default parser', async () => {
    const res = await app.request('/api/comention')
    assert.equal(res.status, 200)
    const body = await res.json()
    const direct = await comentionFor(parseComentionQuery({}))
    assert.deepEqual(JSON.parse(JSON.stringify(direct)), body)
  })

  it('returns { days, persons, pairs } and nothing else', async () => {
    const res = await app.request('/api/comention')
    const body = (await res.json()) as Record<string, unknown>
    assert.deepEqual(Object.keys(body).sort(), ['days', 'pairs', 'persons'])
  })

  it('lists every tracked person, and the lula/tarcisio pair clearing the default min', async () => {
    const res = await app.request('/api/comention')
    const body = (await res.json()) as { persons: { id: string }[]; pairs: { a: string; b: string; count: number }[] }
    assert.deepEqual(body.persons.map((p) => p.id).sort(), ['bolsonaro', 'lula', 'tarcisio'])
    assert.ok(body.pairs.some((p) => p.a === 'lula' && p.b === 'tarcisio' && p.count === 3))
  })

  it('threads days/source/lean/min through the query string', async () => {
    const res = await app.request('/api/comention?min=999')
    const body = (await res.json()) as { pairs: unknown[] }
    assert.deepEqual(body.pairs, [])
  })

  it('is cached, unlike a 404', async () => {
    const res = await app.request('/api/comention')
    assert.ok(res.headers.get('cache-control'))
  })

  it('agrees with /docs?with= for every pair: a matrix cell and its documents never disagree', async () => {
    const res = await app.request('/api/comention?min=1')
    const body = (await res.json()) as { pairs: { a: string; b: string; count: number }[] }
    assert.ok(body.pairs.length > 0)
    for (const { a, b, count } of body.pairs) {
      const docsRes = await app.request(`/api/people/${a}/docs?with=${b}&limit=200`)
      const docsBody = (await docsRes.json()) as { total: number }
      assert.equal(docsBody.total, count, `${a}/${b}`)
    }
  })
})

describe('GET /api/people/:id/lenses (issue #206)', () => {
  before(seed)

  it('an unknown id returns 404 with { error: "person not found" }, the same shape as every other /:id/* route', async () => {
    const res = await app.request('/api/people/does-not-exist/lenses')
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'person not found' })
  })

  it('echoes back the normalized a/b lens tokens', async () => {
    const res = await app.request('/api/people/tarcisio/lenses?a=domain:folha.uol.com.br&b=lean:right')
    assert.equal(res.status, 200)
    const body = (await res.json()) as { a: { lens: string }; b: { lens: string } }
    assert.equal(body.a.lens, 'domain:folha.uol.com.br')
    assert.equal(body.b.lens, 'lean:right')
  })

  it('an unparseable lens (bad syntax, unknown lean, or omitted) falls back to "all" and still returns 200', async () => {
    for (const url of [
      '/api/people/tarcisio/lenses?a=domain:NOT VALID',
      '/api/people/tarcisio/lenses?a=lean:nonsense',
      '/api/people/tarcisio/lenses',
    ]) {
      const res = await app.request(encodeURI(url))
      assert.equal(res.status, 200, url)
      const body = (await res.json()) as { a: { lens: string } }
      assert.equal(body.a.lens, 'all', url)
    }
  })

  it('returns a body of exactly { days, a, b, terms }', async () => {
    const res = await app.request('/api/people/lula/lenses')
    const body = (await res.json()) as Record<string, unknown>
    assert.deepEqual(Object.keys(body).sort(), ['a', 'b', 'days', 'terms'])
  })

  it('bridges=1 adds a bridge field to every term; omitted, the field is absent (issue #219)', async () => {
    const url = '/api/people/lula/lenses?a=domain:g1.globo.com&b=domain:valor.globo.com'
    const res = await app.request(`${url}&bridges=1`)
    const body = (await res.json()) as { terms: { bridge?: number }[] }
    assert.ok(body.terms.length > 0)
    for (const t of body.terms) assert.equal(typeof t.bridge, 'number')
    const plain = await app.request(url)
    const plainBody = (await plain.json()) as { terms: { bridge?: number }[] }
    for (const t of plainBody.terms) assert.ok(!('bridge' in t))
  })
})

describe('GET /api/candidates (issue #32)', () => {
  before(seedCandidates)
  after(reseed)

  const get = async (qs = '') => {
    const res = await app.request(`/api/candidates${qs}`)
    assert.equal(res.status, 200)
    return res.json() as Promise<{ days: number; candidates: { name: string; count: number; sources: number; previous: number; samples: { id: number; source: string; text: string }[] }[] }>
  }

  it('defaults to days=7 min=5, which hides every fixture name (max count is 4)', async () => {
    const body = await get()
    assert.equal(body.days, 7)
    assert.deepEqual(body.candidates, [])
  })

  it('ranks by document count with count, distinct sources and the previous window', async () => {
    const { candidates } = await get('?min=2')
    assert.deepEqual(
      candidates.map(({ name, count, sources, previous }) => ({ name, count, sources, previous })),
      [
        { name: 'hugo motta', count: 4, sources: 4, previous: 0 },
        { name: 'renan calheiros', count: 2, sources: 2, previous: 2 },
      ],
    )
  })

  it('caps samples at three, newest first, with id, source and text only', async () => {
    const { candidates } = await get('?min=2')
    const hugo = candidates.find((c) => c.name === 'hugo motta')!
    assert.equal(hugo.samples.length, 3)
    assert.deepEqual(hugo.samples.map((s) => s.source), ['rss', 'gnews', 'gkg'])
    assert.deepEqual(Object.keys(hugo.samples[0]).sort(), ['id', 'source', 'text'])
    assert.equal(hugo.samples[0].text, 'O Senado ouve Hugo Motta sobre a reforma')
  })

  it('min=1 surfaces the single-doc names and limit trims the list', async () => {
    const all = await get('?min=1')
    assert.deepEqual(all.candidates.map((c) => c.name), ['hugo motta', 'renan calheiros', 'michelle bolsonaro', 'rodrigo pacheco'])
    const one = await get('?min=1&limit=1')
    assert.deepEqual(one.candidates.map((c) => c.name), ['hugo motta'])
  })

  // days=14 until issue #111 enumerated the windows; 30 is the next one up and still wide
  // enough to swallow the previous window and c10 (day 18).
  it('a longer window moves the previous docs into the count', async () => {
    const { candidates } = await get('?days=30&min=2')
    const renan = candidates.find((c) => c.name === 'renan calheiros')!
    assert.equal(renan.count, 5)
    assert.equal(renan.previous, 0)
  })

  it('never lists a tracked alias', async () => {
    const { candidates } = await get('?days=365&min=1&limit=200')
    assert.ok(!candidates.some((c) => ['lula', 'luiz inacio', 'tarcisio', 'bolsonaro', 'jair bolsonaro'].includes(c.name)))
  })

  it('leaves the existing routes untouched', async () => {
    const people = await (await app.request('/api/people')).json() as { id: string }[]
    assert.deepEqual(people.map((p) => p.id).sort(), ['bolsonaro', 'lula', 'tarcisio'])
    const graph = await (await app.request('/api/people/lula/graph')).json() as { person: { id: string } }
    assert.equal(graph.person.id, 'lula')
  })
})

// AC15 in test/graph.test.ts calls docsFor with an already-parsed DocsQuery, so a keepDay bug
// that dropped a valid day would still pass there. These go through the HTTP layer, i.e.
// through parseDocsQuery's keepDay, end to end.
describe('GET /api/people/:id/docs day= (issue #147, AC15 end to end)', () => {
  before(seed)

  it('day=<yesterday BRT> returns only docs whose BRT date is that day', async () => {
    const yesterday = brtYmd(new Date(Date.now() - 86_400_000))
    const res = await app.request(`/api/people/lula/docs?day=${yesterday}`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as { total: number; docs: { published_at: string }[] }
    assert.ok(body.total >= 1, 'Lula\'s day1 cluster must land on yesterday BRT')
    for (const d of body.docs) assert.equal(brtYmd(d.published_at), yesterday)
  })
})

describe('GET /api/people/:id/docs day=today folds a future-dated doc (issue #147, issue #150)', () => {
  before(async () => {
    await seed()
    await insertDocP(futureDoc, persons)
  })
  after(reseed)

  it('day=<today BRT> includes the future-dated doc, whose own BRT date is still ahead', async () => {
    const today = brtYmd(new Date())
    const res = await app.request(`/api/people/bolsonaro/docs?day=${today}`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as { total: number; docs: { uri: string; published_at: string }[] }
    assert.ok(body.docs.some((d) => d.uri === futureDoc.uri))
    for (const d of body.docs) assert.ok(brtYmd(d.published_at) >= today)
  })
})

// keepDay's fallback (src/query.ts): a malformed, future or out-of-window day unfilters rather
// than filtering to zero docs. Pinned here so that behaviour cannot change silently.
describe('GET /api/people/:id/docs day= unfilters on a bad value (issue #147, keepDay)', () => {
  before(seed)

  it('an unparseable day returns the same total as no day at all', async () => {
    const open = (await (await app.request('/api/people/lula/docs')).json()) as { total: number }
    const bad = (await (await app.request('/api/people/lula/docs?day=nope')).json()) as { total: number }
    assert.equal(bad.total, open.total)
  })

  it('a future day, out of every window, also unfilters', async () => {
    const open = (await (await app.request('/api/people/lula/docs')).json()) as { total: number }
    const future = (await (await app.request('/api/people/lula/docs?day=2099-01-01')).json()) as { total: number }
    assert.equal(future.total, open.total)
  })
})

describe('GET /api/people/:id/docs?with= (issue #207)', () => {
  before(seed)

  it('matches docsFor for a known other id', async () => {
    const res = await app.request('/api/people/lula/docs?with=tarcisio')
    assert.equal(res.status, 200)
    const body = await res.json()
    const direct = await docsFor(lula, parseDocsQuery({ with: 'tarcisio' }, 'lula'))
    assert.deepEqual(JSON.parse(JSON.stringify(direct)), body)
    assert.equal((body as { total: number }).total, 3)
  })

  it('an unknown with id, or with equal to the route\'s own :id, returns byte-identical output to no with at all', async () => {
    const open = (await (await app.request('/api/people/lula/docs')).json()) as unknown
    const unknown = (await (await app.request('/api/people/lula/docs?with=nobody-tracked')).json()) as unknown
    const self = (await (await app.request('/api/people/lula/docs?with=lula')).json()) as unknown
    assert.deepEqual(unknown, open)
    assert.deepEqual(self, open)
  })
})

// The parser (query.ts) no longer validates `with` against a seed.json-frozen id set: this
// handler does the lookup itself, against the live persons table, the window a seed edit and
// the next deploy used to open (issue #235 review).
describe('GET /api/people/:id/docs?with= validates against the persons table, not seed.json (issue #235 review)', () => {
  const ghost: Person = { id: 'ghost-not-in-seed', name: 'Ghost', aliases: ['Ghost'] }

  before(async () => {
    await seed()
    assert.ok(!(personsSeed as Person[]).some((p) => p.id === ghost.id), 'sanity: this id must not be in seed.json')
    await upsertPersonsP([...persons, ghost])
    await insertDocP(
      { source: 'rss', uri: 'https://example.org/ghost-1', text: 'Lula e o Ghost debatem juntos', publishedAt: new Date().toISOString(), domain: 'example.org' },
      [...persons, ghost],
    )
  })
  after(reseed)

  it('filters correctly for an id present in the persons table but absent from seed.json', async () => {
    const res = await app.request('/api/people/lula/docs?with=ghost-not-in-seed')
    assert.equal(res.status, 200)
    const body = (await res.json()) as { total: number }
    assert.equal(body.total, 1, 'with= must still filter for an id the seed.json-frozen set would have dropped')
    const direct = await docsFor(lula, parseDocsQuery({ with: 'ghost-not-in-seed' }, 'lula'))
    assert.equal(direct.total, body.total)
  })

  it('an id in neither the table nor seed.json still falls back to no filter', async () => {
    const open = (await (await app.request('/api/people/lula/docs')).json()) as unknown
    const unknown = (await (await app.request('/api/people/lula/docs?with=totally-unknown-id')).json()) as unknown
    assert.deepEqual(unknown, open)
  })
})

describe('the static pages', () => {
  it('GET / serves the atlas as HTML, not a build artifact', async () => {
    const res = await app.request('/')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/html/)
  })

  it('the extracted stylesheet and the one script the page loads are served with the right mime type', async () => {
    const css = await app.request('/atlas.css')
    assert.equal(css.status, 200)
    assert.match(css.headers.get('content-type') ?? '', /text\/css/)
    // The modules are TypeScript under src/ui now, so public/bundle.js is the only script the
    // page loads and the only one that can carry a JavaScript mime type.
    const bundle = await app.request('/bundle.js')
    assert.equal(bundle.status, 200, '/bundle.js must be served')
    assert.match(bundle.headers.get('content-type') ?? '', /javascript/, '/bundle.js must be served with a JavaScript content type')
  })

  // Issue #108: the two legacy pages are deleted outright, not just unlinked. Neither
  // public/index.html nor public/atlas-legacy.html exists any more, and both 404 through the
  // same catch-all static handler that already 404s an archived design.
  it('the two deleted legacy pages 404 and no longer exist under public/', async () => {
    for (const rel of ['index.html', 'atlas-legacy.html']) {
      assert.ok(!existsSync(join(root, 'public', rel)), `public/${rel} must not exist`)
      const res = await app.request(`/${rel}`)
      assert.equal(res.status, 404, `GET /${rel} must 404`)
    }
  })

  // Deleting atlas-legacy.html left two dead hrefs in como-ler.html while the suite stayed
  // green: nothing checked that a link between served pages resolves. A page that names a
  // file is a page that must find it, whichever attribute names it.

  it('GET /como-ler.html answers with the reading page', async () => {
    const res = await app.request('/como-ler.html')
    assert.equal(res.status, 200)
    assert.match(await res.text(), /Como ler o rashomon/)
  })
})

describe('seed.json party/office/uf, echoed by /api/people (issue #212)', () => {
  before(seed)
  const seedList = personsSeed as Person[]

  it('seed.json carries at least one entry with party, office, uf and wikidata together (issue #212 AC1)', () => {
    const withAllFour = seedList.find((p) => p.party && p.office && p.uf && p.wikidata)
    assert.ok(withAllFour, 'no seed.json entry carries party, office, uf and wikidata together')
  })

  it('every seed.json entry carries a wikidata QID (issue #212 AC2)', () => {
    for (const p of seedList) assert.match(p.wikidata ?? '', /^Q\d+$/, `${p.id} has no wikidata QID`)
  })

  it('withSeedFields defaults to a map built from the real seed.json, with no explicit seedMap argument (issue #212 AC3)', () => {
    const real = seedList.find((p) => p.party || p.office || p.uf)
    assert.ok(real, 'seed.json has no entry with party/office/uf to exercise the default map against')
    const row = { id: real!.id, name: real!.name, aliases: real!.aliases }
    const withDefault = withSeedFields(row)
    if (real!.party) assert.equal(withDefault.party, real!.party)
    if (real!.office) assert.equal(withDefault.office, real!.office)
    if (real!.uf) assert.equal(withDefault.uf, real!.uf)
    assert.ok(!('wikidata' in withDefault), 'withSeedFields must never echo wikidata, even via the default map')
  })

  it('withSeedFields echoes present fields, omits absent ones, never echoes wikidata, and passes an unmapped id through unchanged (issue #212 AC4)', () => {
    const seedMap = new Map<string, Person>([
      ['full', { id: 'full', name: 'Full', aliases: [], party: 'PSOL', office: 'deputada', uf: 'RJ', wikidata: 'Q999' }],
      ['partial', { id: 'partial', name: 'Partial', aliases: [], office: 'prefeito' }],
    ])

    const full = withSeedFields({ id: 'full', name: 'Full', aliases: [] }, seedMap)
    assert.deepEqual(full, { id: 'full', name: 'Full', aliases: [], party: 'PSOL', office: 'deputada', uf: 'RJ' })
    assert.ok(!('wikidata' in full))

    const partial = withSeedFields({ id: 'partial', name: 'Partial', aliases: [] }, seedMap)
    assert.deepEqual(partial, { id: 'partial', name: 'Partial', aliases: [], office: 'prefeito' })
    assert.ok(!('party' in partial))
    assert.ok(!('uf' in partial))

    const unmapped = { id: 'ghost', name: 'Ghost', aliases: [] }
    assert.deepEqual(withSeedFields(unmapped, seedMap), unmapped)
  })

  it('GET /api/people rows carry only id/name/aliases/party/office/uf keys, never wikidata (issue #212 AC5)', async () => {
    const res = await app.request('/api/people')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>[]
    assert.ok(body.length > 0)
    const allowed = new Set(['id', 'name', 'aliases', 'party', 'office', 'uf'])
    for (const p of body) {
      for (const key of Object.keys(p)) assert.ok(allowed.has(key), `unexpected key '${key}' on /api/people row`)
      assert.ok(!('wikidata' in p), 'wikidata must never be echoed by /api/people')
    }
  })
})

describe('GET /api/people/:id/graph?kind=org (issue #209)', () => {
  before(async () => {
    await seed()
    await insertDocP(
      {
        source: 'gkg',
        uri: 'https://gdeltproject.org/209-server-org',
        text: 'Lula se reune com a petrobras e o banco central',
        publishedAt: new Date().toISOString(),
        domain: 'gdeltproject.org',
        tone: 0.1,
        extraTerms: [
          { term: 'petrobras', kind: 'org' },
          { term: 'banco central', kind: 'org' },
          // Same bare word as lula's own alias: must be dropped from her graph like any own-name term.
          { term: 'lula', kind: 'org' },
        ],
      },
      persons,
    )
  })
  after(reseed)

  it('returns only kind: org nodes through the Hono app', async () => {
    // min=1: the seeded doc mentions each org term once, under GraphQuery's default min of 2.
    const res = await app.request('/api/people/lula/graph?kind=org&days=7&min=1')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Awaited<ReturnType<typeof graphFor>>
    assert.ok(body.nodes.length > 0, 'the org doc must surface at least one org node')
    for (const node of body.nodes) assert.equal(node.kind, 'org')
    assert.equal(body.nodes.some((n) => n.term === 'lula'), false, "the person's own name is dropped even as an org term")
  })
})

describe('GET /api/people/:id/persistence (issue #215)', () => {
  const cur = mondayOf(brtDate())
  type Body = { weeks: number; since: string; first_week: string | null; horizon: number; terms: { term: string; kind: string; series: { week: string; count: number | null }[]; streak: number; half_life: number | null }[] }
  const get = async (qs = '', id = 'lula') => app.request(`/api/people/${id}/persistence${qs}`)

  before(seed)
  beforeEach(() => db.exec(`delete from term_weeks`))
  after(async () => {
    await db.exec(`delete from term_weeks`)
    await reseed()
  })

  it('defaults to twelve weeks ending at the current BRT Monday, with since and horizon', async () => {
    await db.query(`insert into term_weeks (person_id, term, kind, week, count, c_t) values ('lula', 'anistia', 'word', $1, 4, 9), ('lula', 'anistia', 'word', $2, 6, 9)`, [addDays(cur, -7), cur])
    const res = await get()
    assert.equal(res.status, 200)
    const body = (await res.json()) as Body
    assert.equal(body.weeks, 12)
    assert.equal(body.since, '2026-09-09')
    assert.equal(body.horizon, Math.max(...DAYS))
    assert.equal(body.first_week, addDays(cur, -7))
    assert.equal(body.terms.length, 1)
    const [t] = body.terms
    assert.equal(t.series.length, 12)
    assert.equal(t.series.at(-1)!.week, cur)
    assert.deepEqual(t.series.slice(-3).map((x) => x.count), [null, 4, 6])
    assert.equal(t.streak, 2)
    assert.equal(t.half_life, null)
  })

  it('snaps weeks onto 4, 12, 26 and limit onto LIMITS, and ignores unknown keys', async () => {
    await db.query(`insert into term_weeks (person_id, term, kind, week, count, c_t) values ('lula', 'anistia', 'word', $1, 4, 9)`, [cur])
    for (const [qs, weeks] of [['?weeks=8', 4], ['?weeks=19', 12], ['?weeks=abc', 12], ['?weeks=26&days=7&source=rss', 26]] as const) {
      const body = (await (await get(qs)).json()) as Body
      assert.equal(body.weeks, weeks, qs)
      assert.equal(body.terms[0].series.length, weeks, qs)
    }
  })

  it('a known person with no rows answers 200 with empty terms and a null first_week; an unknown person 404s', async () => {
    const res = await get('', 'tarcisio')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Body
    assert.deepEqual(body.terms, [])
    assert.equal(body.first_week, null)
    const missing = await get('', 'nobody')
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { error: 'person not found' })
  })
})

describe('GET /api/people/:id/docs?week= (issue #215)', () => {
  const HOUR = 3_600_000
  const word = 'semanaservidor'
  const today = brtDate()
  const cur = mondayOf(today)
  const prev = addDays(cur, -7)
  const wed = addDays(prev, 2)
  let seq = 0
  const put = (at: Date) =>
    insertDocP({ source: 'rss', uri: `https://weekroute.test/${seq++}`, text: `Lula ${word}`, publishedAt: at.toISOString(), domain: 'weekroute.test' }, persons)
  type Body = { total: number; docs: { uri: string; published_at: string }[] }
  const get = async (qs: string) => {
    const res = await app.request(`/api/people/lula/docs?term=${word}&${qs}`)
    assert.equal(res.status, 200)
    return (await res.json()) as Body
  }
  const inWeek = (body: Body, monday: string) => body.docs.every((d) => {
    const day = brtYmd(d.published_at)
    return day >= monday && day < addDays(monday, 7)
  })

  before(async () => {
    await seed()
    await put(new Date(brtMidnightUtc(prev).getTime() - HOUR))
    await put(new Date(brtMidnightUtc(prev).getTime() + HOUR))
    await put(new Date(brtMidnightUtc(cur).getTime() - HOUR))
    await put(new Date(brtMidnightUtc(cur).getTime() + HOUR))
    await put(new Date(brtMidnightUtc(addDays(today, 1)).getTime() + HOUR))
  })
  after(async () => {
    await db.exec(`delete from docs where uri like 'https://weekroute.test/%'`)
    await reseed()
  })

  it('week=<Wednesday> returns exactly the docs of that BRT week, total matching', async () => {
    const body = await get(`week=${wed}`)
    assert.equal(body.total, 2)
    assert.equal(body.docs.length, 2)
    assert.ok(inWeek(body, prev))
  })

  it('a doc dated after the end of today is in the current week and not in the previous one', async () => {
    const current = await get(`week=${cur}`)
    const previous = await get(`week=${prev}`)
    assert.ok(current.docs.some((d) => d.uri.endsWith('/4')))
    assert.ok(!previous.docs.some((d) => d.uri.endsWith('/4')))
    assert.equal(current.total, 2)
  })

  it('a valid day wins: day=X&week=Y returns what day=X returns', async () => {
    const dayOnly = await get(`day=${today}`)
    assert.ok(dayOnly.total >= 1)
    assert.deepEqual(await get(`day=${today}&week=${wed}`), dayOnly)
  })

  it('a malformed, future or out-of-window week returns what the request without week returns', async () => {
    const open = await get('days=30')
    for (const week of ['nope', '2026-02-31', addDays(cur, 14), '2020-01-06']) assert.deepEqual(await get(`week=${week}`), open, week)
  })

  it('a malformed, future or out-of-window day with a valid week returns what that week alone returns', async () => {
    const weekOnly = await get(`week=${wed}`)
    for (const day of ['nope', '2099-01-01', '2020-01-01']) assert.deepEqual(await get(`day=${day}&week=${wed}`), weekOnly, day)
  })
})
