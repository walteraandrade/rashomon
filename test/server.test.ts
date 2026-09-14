import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { docsFor, graphFor, risingFor, sourcesFor, timelineFor, toneFor, weekFor } from '../src/graph.js'
import { parseDocsQuery, parseQuery, parseRisingQuery, parseTestimonyQuery, parseTimelineQuery, parseToneQuery, parseWeekQuery } from '../src/query.js'
import { methods } from '../src/scorers/index.js'
import { app } from '../src/server.js'
import { insertDoc } from '../src/store.js'
import { withEnv } from './env.js'
import { futureDoc, insertTestimony, persons, reseed, seed, seedCandidates } from './fixture.js'
import './close.js'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

  it('graph, sources, docs, timeline, rising, tone and people', async () => {
    const id = 'tarcisio'
    const [graphRes, sourcesRes, docsRes, timelineRes, weekRes, risingRes, toneRes, peopleRes] = await Promise.all([
      app.request(`/api/people/${id}/graph`),
      app.request(`/api/people/${id}/sources`),
      app.request(`/api/people/${id}/docs`),
      app.request(`/api/people/${id}/timeline`),
      app.request(`/api/people/${id}/week`),
      app.request(`/api/people/${id}/rising`),
      app.request(`/api/tone`),
      app.request(`/api/people`),
    ])
    const [graphBody, sourcesBody, docsBody, timelineBody, weekBody, risingBody, toneBody, peopleBody] = await Promise.all([
      graphRes.json(),
      sourcesRes.json(),
      docsRes.json(),
      timelineRes.json(),
      weekRes.json(),
      risingRes.json(),
      toneRes.json(),
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
    const { rows } = await db.query(`select id, name, aliases from persons order by name`)
    assert.deepEqual(JSON.parse(JSON.stringify(rows)), peopleBody)
  })

  it('/api/people/:id/graph stats are the fixture literals test/graph.test.ts pins', async () => {
    const res = await app.request('/api/people/lula/graph')
    const body = (await res.json()) as { stats: { docs: number; about: number } }
    assert.equal(body.stats.docs, 14)
    assert.equal(body.stats.about, 5)
  })

  it('/api/people list shape carries no testimony fields', async () => {
    const res = await app.request('/api/people')
    const body = (await res.json()) as Record<string, unknown>[]
    assert.ok(Array.isArray(body))
    for (const p of body) assert.deepEqual(Object.keys(p).sort(), ['aliases', 'id', 'name'])
  })

  it('/api/tone matches toneFor and the fixture literal', async () => {
    const res = await app.request('/api/tone')
    const body = (await res.json()) as { cells: { person_id: string; domain: string; tone: number; n: number }[] }
    const cell = body.cells.find((c) => c.person_id === 'tarcisio' && c.domain === 'estadao.com.br')
    assert.deepEqual(cell, { person_id: 'tarcisio', domain: 'estadao.com.br', tone: -1, n: 3 })
    assert.deepEqual(JSON.parse(JSON.stringify(await toneFor({ days: 30, min: 3 }))), body)
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

  it('issue #25 AC8: GET /graph?source=senado for a person with zero senado docs returns the empty, stats.docs===0 shape', async () => {
    const res = await app.request('/api/people/lula/graph?source=senado&days=365')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Awaited<ReturnType<typeof graphFor>>
    assert.deepEqual(body.nodes, [])
    assert.deepEqual(body.links, [])
    assert.deepEqual(body.signature, [])
    assert.equal(body.stats.docs, 0)
  })
})

describe('GET /api/people/:id/testimony (issue #21)', () => {
  before(seed)

  it('AC2: an unknown id returns 404 with { error: "person not found" }, the same shape as every other /:id/* route', async () => {
    const res = await app.request('/api/people/does-not-exist/testimony')
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'person not found' })
  })

  it('AC2b: wires the querystring through parseTestimonyQuery end to end', async () => {
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
    await insertDoc(
      { source: 'gnews', uri: 'https://g1.globo.com/week-kind-a', text: 'Lula é só isso #planalto', publishedAt: new Date().toISOString(), domain: 'g1.globo.com' },
      persons,
    )
    await insertDoc(
      { source: 'gnews', uri: 'https://g1.globo.com/week-kind-b', text: 'Lula outra vez isso #planalto', publishedAt: new Date().toISOString(), domain: 'g1.globo.com' },
      persons,
    )
  })
  after(reseed)

  it('issue #147 AC1: GET /api/people/nobody/week is the same 404', async () => {
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

describe('GET /api/compare (issue #93)', () => {
  before(seed)

  it('AC1: returns 200 with a body of exactly { days, a, b, terms } — no links/signature/nodes/outlets', async () => {
    const res = await app.request('/api/compare?a=lula&b=bolsonaro')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>
    assert.deepEqual(Object.keys(body).sort(), ['a', 'b', 'days', 'terms'])
    assert.ok(!('links' in (body.a as object)))
  })

  it('AC2: a.person and b.person are each { id, name, aliases }, matching the persons row', async () => {
    const res = await app.request('/api/compare?a=lula&b=bolsonaro')
    const body = (await res.json()) as { a: { person: unknown }; b: { person: unknown } }
    assert.deepEqual(body.a.person, { id: lula.id, name: lula.name, aliases: lula.aliases })
    assert.deepEqual(body.b.person, { id: bolsonaro.id, name: bolsonaro.name, aliases: bolsonaro.aliases })
  })

  it('AC3/AC4: an unknown a, an unknown b, or both omitted return 404 with { error: "person not found" }', async () => {
    for (const url of ['/api/compare?a=nobody&b=lula', '/api/compare?a=lula&b=nobody', '/api/compare']) {
      const res = await app.request(url)
      assert.equal(res.status, 404, url)
      assert.deepEqual(await res.json(), { error: 'person not found' })
    }
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

  it('AC5: defaults to days=7 min=5, which hides every fixture name (max count is 4)', async () => {
    const body = await get()
    assert.equal(body.days, 7)
    assert.deepEqual(body.candidates, [])
  })

  it('AC5: ranks by document count with count, distinct sources and the previous window', async () => {
    const { candidates } = await get('?min=2')
    assert.deepEqual(
      candidates.map(({ name, count, sources, previous }) => ({ name, count, sources, previous })),
      [
        { name: 'hugo motta', count: 4, sources: 4, previous: 0 },
        { name: 'renan calheiros', count: 2, sources: 2, previous: 2 },
      ],
    )
  })

  it('AC5: caps samples at three, newest first, with id, source and text only', async () => {
    const { candidates } = await get('?min=2')
    const hugo = candidates.find((c) => c.name === 'hugo motta')!
    assert.equal(hugo.samples.length, 3)
    assert.deepEqual(hugo.samples.map((s) => s.source), ['rss', 'gnews', 'gkg'])
    assert.deepEqual(Object.keys(hugo.samples[0]).sort(), ['id', 'source', 'text'])
    assert.equal(hugo.samples[0].text, 'O Senado ouve Hugo Motta sobre a reforma')
  })

  it('AC5: min=1 surfaces the single-doc names and limit trims the list', async () => {
    const all = await get('?min=1')
    assert.deepEqual(all.candidates.map((c) => c.name), ['hugo motta', 'renan calheiros', 'michelle bolsonaro', 'rodrigo pacheco'])
    const one = await get('?min=1&limit=1')
    assert.deepEqual(one.candidates.map((c) => c.name), ['hugo motta'])
  })

  // days=14 until issue #111 enumerated the windows; 30 is the next one up and still wide
  // enough to swallow the previous window this criterion is about.
  it('AC5: a longer window moves the previous docs into the count', async () => {
    const { candidates } = await get('?days=30&min=2')
    const renan = candidates.find((c) => c.name === 'renan calheiros')!
    assert.equal(renan.count, 4)
    assert.equal(renan.previous, 0)
  })

  it('AC5: never lists a tracked alias', async () => {
    const { candidates } = await get('?days=365&min=1&limit=200')
    assert.ok(!candidates.some((c) => ['lula', 'luiz inacio', 'tarcisio', 'bolsonaro', 'jair bolsonaro'].includes(c.name)))
  })

  it('AC5: leaves the existing routes untouched', async () => {
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
    await insertDoc(futureDoc, persons)
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
  it('AC8: the two deleted legacy pages 404 and no longer exist under public/', async () => {
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
