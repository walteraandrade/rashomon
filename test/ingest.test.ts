import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { Effect, Exit, Fiber, Layer } from 'effect'
import { TestClock, TestConsole } from 'effect/testing'
import { FetchHttpClient, type HttpClient } from 'effect/unstable/http'
import { SqlClient, SqlError } from 'effect/unstable/sql'
import { db, runSql } from '../src/db.js'
import { fetchClient } from '../src/http.js'
import { collectors, defaultSources } from '../src/collectors/index.js'
import { RssError } from '../src/collectors/rss.js'
import { ingest, IngestFailure } from '../src/ingest.js'
import { DAYS } from '../src/query.js'
import { insertDocP } from '../src/store.js'
import type { RawDoc, Source } from '../src/types.js'
import { attentionRows, insertCandidate, insertTestimony, persons, reseed } from './fixture.js'
import { failingSql, failureOf, fakeFetch, json } from './effect.js'
import { withEnv } from './env.js'
import { docsText } from './docs.js'
import './close.js'

// ingest's Effect requires HttpClient (from the Collector type) and SqlClient (ditto, plus
// migrate/pruneRemoved/upsertPersons/insertDocs, which all run against db.ts's own connection).
// The registry merges the real collectors under the stubs, so the fetch behind fetchClient is a
// stub that throws: a source a test forgets to stub fails loudly instead of going online. The
// SqlClient instance is db.ts's own, never a second connection on the same DATA_DIR. `match`
// makes a single stage's own statement fail, through failingSql, the only seam a stage's failure
// can be reached by -- IngestOptions holds no per-stage override.
const noNetwork = fakeFetch(() => {
  throw new Error('no network in tests')
})
const testLayer = async (match?: RegExp) => {
  const real = await runSql(SqlClient.SqlClient)
  return Layer.mergeAll(
    fetchClient,
    Layer.succeed(FetchHttpClient.Fetch, noNetwork),
    Layer.succeed(SqlClient.SqlClient, match ? failingSql(real, match) : real),
    TestConsole.layer,
  )
}

// Drives ingest() on the fake clock: the pageviews stage's own Effect.sleep(1000) (issue #211,
// once per person with a `wikipedia` title, the fixture's lula) would otherwise cost every
// ingest test a real second.
const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient | SqlClient.SqlClient>, layer: Layer.Layer<HttpClient.HttpClient | SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect)
    while (fiber.pollUnsafe() === undefined) {
      yield* TestClock.adjust(1_000)
      yield* Effect.promise(() => new Promise<void>((r) => setImmediate(r)))
    }
    const exit = yield* Fiber.await(fiber)
    const logs = (yield* TestConsole.logLines).map(String)
    const errors = (yield* TestConsole.errorLines).map(String)
    return { exit, logs, errors }
  }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer()))

const doc = (uri: string, text: string): RawDoc => ({ source: 'rss', uri, text, publishedAt: new Date().toISOString(), domain: 'example.org' })

describe('ingest', () => {
  // The tests below write fresh, uniquely-uried docs alongside the fixture; nothing here reads
  // a count the fixture alone would give, so one reseed at the end is enough.
  after(reseed)

  it('writes every named source and returns matching counts', async () => {
    const docsA = [doc('https://ingest-test.example/a1', 'Lula fala sobre a economia'), doc('https://ingest-test.example/a2', 'Lula visita a Bahia')]
    const layer = await testLayer()
    const { exit } = await Effect.runPromise(
      run(
        ingest(persons, ['rss', 'gdelt'], {
          collectors: { rss: () => Effect.succeed(docsA), gdelt: () => Effect.succeed([]) },
        }),
        layer,
      ),
    )
    assert.ok(Exit.isSuccess(exit))
    const report = exit.value
    assert.equal(report.sources.length, 2)
    assert.equal(report.sources[0].name, 'rss')
    assert.equal(report.sources[0].written, docsA.length)
    assert.equal(report.sources[0].error, undefined)
    assert.equal(report.sources[1].name, 'gdelt')
    assert.equal(report.sources[1].fetched, 0)
    assert.equal(report.sources[1].written, 0)
  })

  it('logs and continues past one failing source', async () => {
    const docsB = [doc('https://ingest-test.example/b1', 'Tarcísio inaugura uma obra')]
    const layer = await testLayer()
    const { exit, errors, logs } = await Effect.runPromise(
      run(
        ingest(persons, ['rss', 'gdelt'], {
          collectors: { rss: () => Effect.fail(new RssError({ message: 'rss boom' })), gdelt: () => Effect.succeed(docsB) },
        }),
        layer,
      ),
    )
    assert.ok(Exit.isSuccess(exit))
    const report = exit.value
    const rss = report.sources.find((s) => s.name === 'rss')!
    const gdelt = report.sources.find((s) => s.name === 'gdelt')!
    assert.equal(rss.error, 'rss boom')
    assert.equal(rss.written, 0)
    assert.equal(rss.enriched, 0)
    assert.equal(rss.failed, 0)
    assert.equal(gdelt.error, undefined)
    assert.equal(gdelt.written, docsB.length)
    assert.ok(errors.some((line) => line.includes('[rss] rss boom')))
    assert.ok(logs.some((line) => line.includes('[rss] fetched 0, new 0')))
    assert.ok(logs.some((line) => line.includes(`[gdelt] fetched ${docsB.length}, new ${docsB.length}`)))
  })

  it('fails the whole run when upsertPersons rejects', async () => {
    const layer = await testLayer(/^insert into persons/)
    const docsC = [doc('https://ingest-test.example/c1', 'Lula anuncia uma medida')]
    const { exit } = await Effect.runPromise(
      run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed(docsC) } }), layer),
    )
    assert.ok(Exit.isFailure(exit))
    const failure = failureOf(exit)
    assert.ok(failure instanceof IngestFailure)
    assert.equal(failure.stage, 'upsertPersons')
    assert.ok(failure.cause instanceof SqlError.SqlError)
    const { rows } = await db.query<{ n: number | string }>(`select count(*) as n from docs where uri = $1`, [docsC[0].uri])
    assert.equal(Number(rows[0].n), 0)
  })

  it('fails the whole run with IngestFailure({ stage: "pruneRemoved" }), not an uncaught defect, when pruneRemoved rejects', async () => {
    const layer = await testLayer(/^delete from doc_persons where not/)
    const { exit } = await Effect.runPromise(run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed([]) } }), layer))
    assert.ok(Exit.isFailure(exit))
    const failure = failureOf(exit)
    assert.ok(failure instanceof IngestFailure, 'a rejection must surface as a typed IngestFailure, never an uncaught defect')
    assert.equal(failure.stage, 'pruneRemoved')
    assert.ok(failure.cause instanceof SqlError.SqlError)
  })

  it('fails the whole run with IngestFailure({ stage: "migrate" }) when the schema statement fails, before any collector runs', async () => {
    const layer = await testLayer(/^\s*create table if not exists persons/)
    let rssCalled = false
    const { exit } = await Effect.runPromise(
      run(
        ingest(persons, ['rss'], { collectors: { rss: () => ((rssCalled = true), Effect.succeed([])) } }),
        layer,
      ),
    )
    assert.ok(Exit.isFailure(exit))
    const failure = failureOf(exit)
    assert.ok(failure instanceof IngestFailure)
    assert.equal(failure.stage, 'migrate')
    assert.ok(failure.cause instanceof SqlError.SqlError)
    assert.equal(rssCalled, false, 'rss collector should never run once migrate has failed')
  })

  it('fails the whole run with IngestFailure({ stage: "loadPhrases" }) when the schema statement fails, before any collector runs', async () => {
    const layer = await testLayer(/^select term from phrases/)
    let rssCalled = false
    const { exit } = await Effect.runPromise(
      run(
        ingest(persons, ['rss'], { collectors: { rss: () => ((rssCalled = true), Effect.succeed([])) } }),
        layer,
      ),
    )
    assert.ok(Exit.isFailure(exit))
    const failure = failureOf(exit)
    assert.ok(failure instanceof IngestFailure)
    assert.equal(failure.stage, 'loadPhrases')
    assert.ok(failure.cause instanceof SqlError.SqlError)
    assert.equal(rssCalled, false, 'rss collector should never run once loadPhrases has failed')
  })

  it('fails the whole run with IngestFailure({ stage: "docCount" }), after every named source has already reached insertDocs', async () => {
    const uri = 'https://ingest-test.example/doccount1'
    const layer = await testLayer(/^select count\(\*\) as n from docs/)
    const { exit } = await Effect.runPromise(
      run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed([doc(uri, 'Lula recebe uma comitiva')]) } }), layer),
    )
    assert.ok(Exit.isFailure(exit))
    const failure = failureOf(exit)
    assert.ok(failure instanceof IngestFailure)
    assert.equal(failure.stage, 'docCount')
    assert.ok(failure.cause instanceof SqlError.SqlError)
    const { rows } = await db.query<{ n: number | string }>(`select count(*) as n from docs where uri = $1`, [uri])
    assert.equal(Number(rows[0].n), 1, 'rss must have already reached insertDocs before docCount failed')
  })

  it('fails the whole run with IngestFailure({ stage: "analyzeAfterWrite" }) (ANALYZE_MIN_DOCS=1)', async () => {
    const uri = 'https://ingest-test.example/analyzeafter1'
    const layer = await testLayer(/^analyze docs$/)
    await withEnv({ ANALYZE_MIN_DOCS: '1' }, async () => {
      const { exit } = await Effect.runPromise(
        run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed([doc(uri, 'Lula recebe uma comitiva')]) } }), layer),
      )
      assert.ok(Exit.isFailure(exit))
      const failure = failureOf(exit)
      assert.ok(failure instanceof IngestFailure)
      assert.equal(failure.stage, 'analyzeAfterWrite')
      assert.ok(failure.cause instanceof SqlError.SqlError)
    })
    const { rows } = await db.query<{ n: number | string }>(`select count(*) as n from docs where uri = $1`, [uri])
    assert.equal(Number(rows[0].n), 1, 'rss must have already reached insertDocs before analyzeAfterWrite failed')
  })

  it('fails the whole run with IngestFailure({ stage: "analyzeTables" }), after buildGraphAggregates has already run', async () => {
    const uri = 'https://ingest-test.example/analyzetables1'
    const layer = await testLayer(/^analyze graph_scopes$/)
    const { exit } = await Effect.runPromise(
      run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed([doc(uri, 'Lula recebe uma comitiva')]) } }), layer),
    )
    assert.ok(Exit.isFailure(exit))
    const failure = failureOf(exit)
    assert.ok(failure instanceof IngestFailure)
    assert.equal(failure.stage, 'analyzeTables')
    assert.ok(failure.cause instanceof SqlError.SqlError)
    const { rows } = await db.query<{ n: number | string }>(`select count(*) as n from docs where uri = $1`, [uri])
    assert.equal(Number(rows[0].n), 1, 'rss must have already reached insertDocs before analyzeTables failed')
  })

  it('fails the whole run with IngestFailure({ stage: "pageviews" }) when the write itself fails, never through a fetch failure (issue #211 AC10)', async () => {
    const uri = 'https://ingest-test.example/pageviews1'
    // The pageviews collector must actually produce a row for the write to have something to
    // fail on: a stub that resolves the wikipedia pageviews endpoint, throws for anything else.
    const pageviewsFetch = fakeFetch((c) =>
      c.url.pathname.includes('/pageviews/per-article/') ? json({ items: [{ timestamp: '2026010100', views: 7 }] }) : (() => {
        throw new Error('no network in tests')
      })(),
    )
    const real = await runSql(SqlClient.SqlClient)
    const layer = Layer.mergeAll(
      fetchClient,
      Layer.succeed(FetchHttpClient.Fetch, pageviewsFetch),
      Layer.succeed(SqlClient.SqlClient, failingSql(real, /^insert into person_attention/)),
      TestConsole.layer,
    )
    const { exit } = await Effect.runPromise(
      run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed([doc(uri, 'Lula recebe uma comitiva')]) } }), layer),
    )
    assert.ok(Exit.isFailure(exit))
    const failure = failureOf(exit)
    assert.ok(failure instanceof IngestFailure)
    assert.equal(failure.stage, 'pageviews')
    assert.ok(failure.cause instanceof SqlError.SqlError)
    const { rows } = await db.query<{ n: number | string }>(`select count(*) as n from docs where uri = $1`, [uri])
    assert.equal(Number(rows[0].n), 1, 'rss must have already reached insertDocs before the pageviews write failed')
  })

  it('analyzeTables also covers term_communities, written by the same buildGraphAggregates call', async () => {
    const uri = 'https://ingest-test.example/analyzetables2'
    const layer = await testLayer(/^analyze term_communities$/)
    const { exit } = await Effect.runPromise(
      run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed([doc(uri, 'Lula recebe uma comitiva')]) } }), layer),
    )
    assert.ok(Exit.isFailure(exit))
    const failure = failureOf(exit)
    assert.ok(failure instanceof IngestFailure)
    assert.equal(failure.stage, 'analyzeTables')
    assert.ok(failure.cause instanceof SqlError.SqlError)
    const { rows } = await db.query<{ n: number | string }>(`select count(*) as n from docs where uri = $1`, [uri])
    assert.equal(Number(rows[0].n), 1, 'rss must have already reached insertDocs before analyzeTables failed')
  })

  it('SourceResult carries dropped and the log line reads fetched, new, dropped', async () => {
    const mixed = [doc('https://ingest-test.example/m1', 'Lula fala sobre a safra'), doc('https://ingest-test.example/m2', 'Congresso vota a pauta'), doc('https://ingest-test.example/m3', 'Governo anuncia obras')]
    const layer = await testLayer()
    const { exit, logs } = await Effect.runPromise(run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed(mixed) } }), layer))
    assert.ok(Exit.isSuccess(exit))
    assert.deepEqual(exit.value.sources[0], { name: 'rss', fetched: 3, written: 1, enriched: 0, dropped: 2, failed: 0 })
    assert.ok(logs.includes('[rss] fetched 3, new 1, dropped 2'), JSON.stringify(logs))
  })

  it('appends enriched and failed to the log line only when non-zero, after dropped', async () => {
    const uri = 'https://ingest-test.example/enrich1'
    const layer = await testLayer()
    await Effect.runPromise(run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed([doc(uri, 'Lula fala sobre a safra')]) } }), layer))
    const longer = doc(uri, 'Lula fala sobre a safra e detalha o plano de exportação para os próximos meses')
    const { logs } = await Effect.runPromise(run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed([longer, doc('https://ingest-test.example/enrich2', 'Governo anuncia obras')]) } }), layer))
    assert.ok(logs.includes('[rss] fetched 2, new 0, dropped 1, enriched 1'), JSON.stringify(logs))
  })

  it('reports dropped 0 for a source that fails and for one that is unknown', async () => {
    const layer = await testLayer()
    const { exit } = await Effect.runPromise(
      run(ingest(persons, ['rss', 'no-such-source'], { collectors: { rss: () => Effect.fail(new RssError({ message: 'rss boom' })) } }), layer),
    )
    assert.ok(Exit.isSuccess(exit))
    assert.deepEqual(exit.value.sources.map((s) => s.dropped), [0, 0])
  })

  it('a source of only untracked docs reports new 0, dropped N and writes no row', async () => {
    const only = [doc('https://ingest-test.example/u1', 'Congresso vota a pauta'), doc('https://ingest-test.example/u2', 'Governo anuncia obras')]
    const layer = await testLayer()
    const { exit, logs } = await Effect.runPromise(run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed(only) } }), layer))
    assert.ok(Exit.isSuccess(exit))
    assert.deepEqual(exit.value.sources[0], { name: 'rss', fetched: 2, written: 0, enriched: 0, dropped: 2, failed: 0 })
    assert.ok(logs.includes('[rss] fetched 2, new 0, dropped 2'))
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from docs where uri = any($1::text[])`, [only.map((d) => d.uri)])
    assert.equal(rows[0].n, 0)
  })

  it('dropped docs do not count toward ANALYZE_MIN_DOCS', async () => {
    const batch = [doc('https://ingest-test.example/n1', 'Lula fala sobre a safra de grãos'), ...['n2', 'n3', 'n4'].map((k) => doc(`https://ingest-test.example/${k}`, 'Governo anuncia obras novas'))]
    const layer = await testLayer()
    await withEnv({ ANALYZE_MIN_DOCS: '2' }, async () => {
      const { logs } = await Effect.runPromise(run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed(batch) } }), layer))
      assert.ok(logs.includes('skipped analyze: 1 new docs below ANALYZE_MIN_DOCS=2'), JSON.stringify(logs))
    })
  })

  it('respects names order, one source at a time', async () => {
    const order: string[] = []
    const slow = (name: string, ms: number) =>
      Effect.gen(function* () {
        order.push(`start:${name}`)
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)))
        order.push(`end:${name}`)
        return [] as RawDoc[]
      })
    const layer = await testLayer()
    const { exit } = await Effect.runPromise(
      run(
        ingest(persons, ['bluesky', 'rss'], {
          collectors: { bluesky: () => slow('bluesky', 20), rss: () => slow('rss', 0) },
        }),
        layer,
      ),
    )
    assert.ok(Exit.isSuccess(exit))
    assert.deepEqual(order, ['start:bluesky', 'end:bluesky', 'start:rss', 'end:rss'])
    assert.deepEqual(
      exit.value.sources.map((s) => s.name),
      ['bluesky', 'rss'],
    )
  })

  it('logs skipped analyze under ANALYZE_MIN_DOCS and analyzed above it', async () => {
    const layer = await testLayer()
    const docD = [doc('https://ingest-test.example/d1', 'Lula fala sobre inflação')]
    await withEnv({ ANALYZE_MIN_DOCS: String(docD.length + 1) }, async () => {
      const { logs } = await Effect.runPromise(run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed(docD) } }), layer))
      assert.ok(logs.some((line) => line.startsWith('skipped analyze:')))
    })
    const docE = [doc('https://ingest-test.example/e1', 'Lula fala sobre educação')]
    await withEnv({ ANALYZE_MIN_DOCS: '1' }, async () => {
      const { logs } = await Effect.runPromise(run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed(docE) } }), layer))
      assert.ok(logs.some((line) => line.startsWith('analyzed ')))
    })
  })

  it('rebuilds aggregates even when nothing was written', async () => {
    const layer = await testLayer()
    const { exit } = await Effect.runPromise(
      run(ingest(persons, ['rss', 'gdelt'], { collectors: { rss: () => Effect.succeed([]), gdelt: () => Effect.succeed([]) } }), layer),
    )
    assert.ok(Exit.isSuccess(exit))
    assert.ok(exit.value.aggregates.scopes > 0)
    assert.equal(
      exit.value.sources.reduce((sum, s) => sum + s.written, 0),
      0,
    )
  })

  it('logs an error and continues for a name outside the collector registry', async () => {
    const layer = await testLayer()
    const { exit, errors } = await Effect.runPromise(run(ingest(persons, ['not-a-source' as Source, 'rss'], { collectors: { rss: () => Effect.succeed([]) } }), layer))
    assert.ok(Exit.isSuccess(exit))
    const unknown = exit.value.sources.find((s) => s.name === 'not-a-source')!
    assert.equal(unknown.error, 'unknown source: not-a-source')
    assert.equal(unknown.written, 0)
    assert.ok(errors.some((line) => line.includes('[not-a-source] unknown source: not-a-source')))
  })
})

// Acceptance criteria for issue #185 (Effect orchestration, Collector becomes an Effect).
describe('ingest acceptance, checked against the rows written and the calls made', () => {
  after(reseed)

  it('every registered collector is an Effect, never a Promise-returning wrapper', () => {
    for (const [source, collect] of Object.entries(collectors)) {
      const produced = collect(persons)
      assert.ok(Effect.isEffect(produced), `collectors['${source}'] must be an Effect`)
      assert.ok(!(produced instanceof Promise), `collectors['${source}'] must not be a Promise`)
    }
  })

  it('a failing source leaves every other named source reaching insertDocs, with written matching the rows actually inserted', async () => {
    const uris = ['https://ac185-2.example/a', 'https://ac185-2.example/b']
    const okDocs = uris.map((uri, i) => doc(uri, i === 0 ? 'Lula assina um decreto' : 'Lula recebe uma comitiva'))
    const layer = await testLayer()
    const { exit } = await Effect.runPromise(
      run(
        ingest(persons, ['rss', 'gdelt'], {
          collectors: { rss: () => Effect.fail(new RssError({ message: 'ac185-2 boom' })), gdelt: () => Effect.succeed(okDocs) },
        }),
        layer,
      ),
    )
    assert.ok(Exit.isSuccess(exit))
    const rss = exit.value.sources.find((s) => s.name === 'rss')!
    const gdelt = exit.value.sources.find((s) => s.name === 'gdelt')!
    assert.ok(rss.error)
    assert.equal(rss.written, 0)
    assert.equal(rss.enriched, 0)
    assert.equal(rss.failed, 0)
    assert.equal(gdelt.error, undefined)
    const { rows } = await db.query<{ n: number | string }>(`select count(*) as n from docs where uri = any($1)`, [uris])
    assert.equal(Number(rows[0].n), uris.length, 'the ok source must actually have written its docs')
    assert.equal(gdelt.written, Number(rows[0].n))
  })

  it('Console.error shows exactly one line for the failing source, and Console.log shows a fetched line for every named source', async () => {
    const okDocs = [doc('https://ac185-3.example/a', 'Tarcísio recebe visita internacional')]
    const layer = await testLayer()
    const { errors, logs } = await Effect.runPromise(
      run(
        ingest(persons, ['rss', 'gdelt'], {
          collectors: { rss: () => Effect.fail(new RssError({ message: 'ac185-3 boom' })), gdelt: () => Effect.succeed(okDocs) },
        }),
        layer,
      ),
    )
    const rssErrorLines = errors.filter((line) => line.includes('[rss]'))
    assert.equal(rssErrorLines.length, 1, 'exactly one [rss] error line')
    assert.ok(rssErrorLines[0].includes('ac185-3 boom'))
    assert.ok(logs.some((line) => line.includes('[rss] fetched 0, new 0')))
    assert.ok(logs.some((line) => line.includes(`[gdelt] fetched ${okDocs.length}, new ${okDocs.length}`)))
  })

  it('an upsertPersons rejection fails the whole run with IngestFailure({ stage: "upsertPersons" }) and no source is ever attempted', async () => {
    const layer = await testLayer(/^insert into persons/)
    let rssCalled = false
    const uri = 'https://ac185-4.example/a'
    const { exit } = await Effect.runPromise(
      run(
        ingest(persons, ['rss'], {
          collectors: {
            rss: () => {
              rssCalled = true
              return Effect.succeed([doc(uri, 'Lula participa de reunião de ministros')])
            },
          },
        }),
        layer,
      ),
    )
    assert.ok(Exit.isFailure(exit))
    const failure = failureOf(exit)
    assert.ok(failure instanceof IngestFailure)
    assert.equal(failure.stage, 'upsertPersons')
    assert.ok(failure.cause instanceof SqlError.SqlError)
    assert.equal(rssCalled, false, 'rss collector should never run once upsertPersons has rejected')
    const { rows } = await db.query<{ n: number | string }>(`select count(*) as n from docs where uri = $1`, [uri])
    assert.equal(Number(rows[0].n), 0)
  })

  it('aggregates rebuild (report.aggregates populated) even when every named source yields zero docs', async () => {
    const layer = await testLayer()
    const { exit } = await Effect.runPromise(
      run(ingest(persons, ['rss', 'gdelt'], { collectors: { rss: () => Effect.succeed([]), gdelt: () => Effect.succeed([]) } }), layer),
    )
    assert.ok(Exit.isSuccess(exit))
    assert.equal(
      exit.value.sources.reduce((sum, s) => sum + s.written, 0),
      0,
    )
    assert.ok(exit.value.aggregates.scopes > 0, 'aggregates.scopes must be populated even with zero new docs')
    assert.ok(Number.isFinite(exit.value.aggregates.ms))
  })

  it('sources run one at a time, a later one never starting before the earlier one ends', async () => {
    const events: string[] = []
    const stub = (name: string, ms: number) =>
      Effect.gen(function* () {
        events.push(`${name}:start`)
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)))
        events.push(`${name}:end`)
        return [] as RawDoc[]
      })
    const layer = await testLayer()
    await Effect.runPromise(
      run(ingest(persons, ['gdelt', 'rss'], { collectors: { gdelt: () => stub('gdelt', 25), rss: () => stub('rss', 0) } }), layer),
    )
    assert.deepEqual(events, ['gdelt:start', 'gdelt:end', 'rss:start', 'rss:end'])
  })

  it('report.sources keeps the order names was given in, even when it differs from defaultSources', async () => {
    assert.notDeepEqual(defaultSources.slice(0, 2), ['gdelt', 'rss'])
    const layer = await testLayer()
    const { exit } = await Effect.runPromise(
      run(ingest(persons, ['gdelt', 'rss'], { collectors: { gdelt: () => Effect.succeed([]), rss: () => Effect.succeed([]) } }), layer),
    )
    assert.ok(Exit.isSuccess(exit))
    assert.deepEqual(
      exit.value.sources.map((s) => s.name),
      ['gdelt', 'rss'],
    )
  })

  it('an unknown source name produces a SourceResult with error set, no thrown exception, and the run still succeeds', async () => {
    const layer = await testLayer()
    const { exit, errors } = await Effect.runPromise(
      run(ingest(persons, ['rss', 'nao-existe' as Source], { collectors: { rss: () => Effect.succeed([]) } }), layer),
    )
    assert.ok(Exit.isSuccess(exit), 'an unknown source name must not fail the whole ingest call')
    const unknown = exit.value.sources.find((s) => s.name === 'nao-existe')
    assert.ok(unknown)
    assert.ok(unknown!.error)
    assert.equal(unknown!.written, 0)
    assert.ok(errors.some((line) => line.includes('[nao-existe]')))
  })

  it('the docs state that a failed person-table write sets process.exitCode = 1 and that ingest.ts provides its layers at its own entrypoint', () => {
    assert.match(docsText, /process\.exitCode\s*=\s*1/)
    assert.match(docsText, /upsertPersons.{0,80}rejects.{0,40}process\.exitCode\s*=\s*1|process\.exitCode\s*=\s*1.{0,120}upsertPersons/is, 'the exit-code rule must be tied to the person-table write, not stated in isolation')
    assert.match(docsText, /entrypoint/i, 'no page documents that HttpClient/SqlClient layers are provided at the entrypoint rather than module-level')
  })
})

describe('defaultSources runs gkg before RSS collectors (issue #234)', () => {
  after(reseed)

  const uri = 'https://ingest-test.example/shared-234'
  const gkgDoc: RawDoc = {
    source: 'gkg',
    uri,
    text: 'Lula assina convenio em cerimonia oficial',
    publishedAt: new Date().toISOString(),
    domain: 'ingest-test.example',
    tone: 0.3,
    extraTerms: [{ term: 'petrobras', kind: 'org' }],
  }
  const rssDoc: RawDoc = {
    ...doc(uri, 'Lula assina convenio em cerimonia oficial. O presidente detalhou o acordo firmado com o setor produtivo durante a cerimonia realizada na capital.'),
    domain: 'ingest-test.example',
  }
  const stubs = { gkg: () => Effect.succeed([gkgDoc]), rss: () => Effect.succeed([rssDoc]) }
  const clear = () => db.exec(`delete from docs where uri = '${uri}'`)
  const stored = async () => {
    const row = (await db.query<{ id: number; source: string; text: string; tone: number | null }>(`select id, source, text, tone from docs where uri = $1`, [uri])).rows[0]
    const terms = (await db.query<{ term: string; kind: string }>(`select v.term, v.kind from doc_terms t join terms v on v.id = t.term_id where t.doc_id = $1`, [row.id])).rows
    return { row, terms }
  }

  it('orders gkg ahead of rss, juridico, oficial and nicho and keeps bluesky last', () => {
    const at = (s: Source) => defaultSources.indexOf(s)
    assert.ok(at('gkg') >= 0)
    for (const s of ['rss', 'juridico', 'oficial', 'nicho'] as const) assert.ok(at('gkg') < at(s), `gkg must run before ${s}`)
    assert.equal(defaultSources[defaultSources.length - 1], 'bluesky')
  })

  it('a default-order ingest stores a shared article as gkg with its org terms and the rss body', async () => {
    await clear()
    const names = defaultSources.filter((s) => s === 'gkg' || s === 'rss')
    const layer = await testLayer()
    const { exit } = await Effect.runPromise(run(ingest(persons, names, { collectors: stubs }), layer))
    assert.ok(Exit.isSuccess(exit))
    const { row, terms } = await stored()
    assert.equal(row.source, 'gkg')
    assert.equal(row.text, rssDoc.text)
    assert.equal(row.tone, 0.3)
    assert.ok(terms.some((t) => t.term === 'petrobras' && t.kind === 'org'))
    assert.ok(terms.some((t) => t.term === 'acordo'), 'a word found only in the rss text must be derived')
  })

  it('an explicit rss-then-gkg ingest leaves the row rss with no org terms and null tone', async () => {
    await clear()
    const layer = await testLayer()
    const { exit } = await Effect.runPromise(run(ingest(persons, ['rss', 'gkg'], { collectors: stubs }), layer))
    assert.ok(Exit.isSuccess(exit))
    const { row, terms } = await stored()
    assert.equal(row.source, 'rss')
    assert.equal(row.tone, null)
    assert.ok(!terms.some((t) => t.kind === 'org'))
  })
})

describe('ingest retention (issue #270)', () => {
  after(reseed)

  const HORIZON = Math.max(...DAYS)
  const aged = (uri: string, days: number): RawDoc => ({ ...doc(uri, 'Lula discute a reforma tributária'), publishedAt: new Date(Date.now() - days * 86_400_000).toISOString() })
  const idOf = async (uri: string) => (await db.query<{ id: number }>(`select id from docs where uri = $1`, [uri])).rows[0]?.id as number
  const children = async (id: number) =>
    (
      await db.query<{ persons: number; terms: number; testimony: number; candidates: number }>(
        `select (select count(*) from doc_persons where doc_id = $1)::int as persons,
                (select count(*) from doc_terms where doc_id = $1)::int as terms,
                (select count(*) from doc_testimony where doc_id = $1)::int as testimony,
                (select count(*) from doc_candidates where doc_id = $1)::int as candidates`,
        [id],
      )
    ).rows[0]
  const uriAt = (days: number) => `https://ingest-retention.example/d${days}`
  const seedAged = async (ages: number[]) => {
    for (const days of ages) {
      await insertDocP(aged(uriAt(days), days), persons)
      await insertTestimony(uriAt(days), 'lula', 'stub', 1)
      await insertCandidate(uriAt(days), 'renan calheiros')
    }
  }
  const dropAged = (ages: number[]) => db.exec(`delete from docs where uri like 'https://ingest-retention.example/%'`).then(() => ages)
  const clearOlderThanHorizon = () => db.query(`delete from docs where published_at < now() - make_interval(days => $1::int)`, [HORIZON])
  const runIngest = async (match?: RegExp) => Effect.runPromise(run(ingest(persons, ['rss'], { collectors: { rss: () => Effect.succeed([]) } }), await testLayer(match)))

  it('keeps a 20-day doc and deletes a 22-day doc, cascading to the four derived tables', async () => {
    const ages = [10, 20, 22, 100]
    await seedAged(ages)
    const before = new Map(await Promise.all(ages.map(async (d) => [d, await idOf(uriAt(d))] as const)))
    for (const id of before.values()) {
      const c = await children(id)
      assert.deepEqual([c.persons, c.testimony, c.candidates], [1, 1, 1])
      assert.ok(c.terms > 0)
    }
    const { exit } = await runIngest()
    assert.ok(Exit.isSuccess(exit))
    for (const d of [22, 100]) {
      assert.equal(await idOf(uriAt(d)), undefined, `${d}-day doc is gone`)
      assert.deepEqual(await children(before.get(d)!), { persons: 0, terms: 0, testimony: 0, candidates: 0 }, `${d}-day doc's derived rows are gone`)
    }
    for (const d of [10, 20]) {
      assert.ok(await idOf(uriAt(d)), `${d}-day doc stays`)
      const c = await children(before.get(d)!)
      assert.equal(c.persons, 1)
      assert.ok(c.terms > 0)
      assert.equal(c.testimony, 1)
      assert.equal(c.candidates, 1)
    }
    await dropAged(ages)
  })

  it('reports the deleted count and the trimmed total, logged before total docs', async () => {
    await clearOlderThanHorizon()
    await seedAged([10, 22, 100])
    const { exit, logs } = await runIngest()
    assert.ok(Exit.isSuccess(exit))
    assert.equal(exit.value.deleted, 2)
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from docs`)
    assert.equal(exit.value.totalDocs, rows[0].n)
    const line = logs.findIndex((l) => l === `retention: deleted 2 docs older than ${HORIZON} days`)
    assert.ok(line >= 0, `no retention line in ${JSON.stringify(logs)}`)
    assert.ok(logs.findIndex((l) => l.startsWith('[pageviews]')) < line)
    assert.equal(logs.findIndex((l) => l.startsWith('total docs:')), line + 1)
    await dropAged([])
  })

  it('takes its horizon from DAYS, never a second constant', async () => {
    await clearOlderThanHorizon()
    await seedAged([10, 20, 22, 100])
    const original = [...DAYS]
    DAYS.push(90)
    try {
      const { exit, logs } = await runIngest()
      assert.ok(Exit.isSuccess(exit))
      assert.equal(exit.value.deleted, 1, 'only the 100-day doc lies beyond a 90-day horizon')
      assert.ok(logs.includes('retention: deleted 1 docs older than 90 days'))
      assert.ok(await idOf(uriAt(22)), 'the 22-day doc is inside the widened horizon')
    } finally {
      DAYS.splice(0, DAYS.length, ...original)
    }
    await dropAged([])
  })

  it('with nothing older than the horizon reports zero and still succeeds', async () => {
    await clearOlderThanHorizon()
    const { exit, logs } = await runIngest()
    assert.ok(Exit.isSuccess(exit))
    assert.equal(exit.value.deleted, 0)
    assert.ok(logs.includes(`retention: deleted 0 docs older than ${HORIZON} days`))
  })

  it('leaves person_attention alone', async () => {
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10)
    await attentionRows('lula', [{ day: old, views: 321 }])
    try {
      const { exit } = await runIngest()
      assert.ok(Exit.isSuccess(exit))
      const { rows } = await db.query<{ views: number }>(`select views from person_attention where person_id = 'lula' and day = $1`, [old])
      assert.deepEqual(rows, [{ views: 321 }])
    } finally {
      await db.query(`delete from person_attention where person_id = 'lula' and day = $1`, [old])
    }
  })

  it('fails the whole run with IngestFailure({ stage: "retention" }) when the delete rejects, before any later stage', async () => {
    await db.exec(`delete from graph_scopes`)
    const { exit } = await runIngest(/delete from docs/)
    assert.ok(Exit.isFailure(exit))
    const failure = failureOf(exit)
    assert.ok(failure instanceof IngestFailure)
    assert.equal(failure.stage, 'retention')
    assert.ok(failure.cause instanceof SqlError.SqlError)
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from graph_scopes`)
    assert.equal(rows[0].n, 0, 'buildGraphAggregates never ran')
  })
})

// Issue #313 acceptance criteria, quoted by number.
describe('ingest reports dropped docs and keeps a 21-day horizon (issue #313 acceptance)', () => {
  after(reseed)

  const through = async (source: () => Effect.Effect<RawDoc[], never>, names: string[] = ['rss']) => {
    const { exit, logs } = await Effect.runPromise(run(ingest(persons, names, { collectors: { rss: source } }), await testLayer()))
    assert.ok(Exit.isSuccess(exit))
    return { report: exit.value, logs }
  }
  const storedCount = async (uris: string[]) => (await db.query<{ n: number }>(`select count(*)::int as n from docs where uri = any($1::text[])`, [uris])).rows[0].n

  it('sources[i] carries dropped, fetched includes dropped docs and the log line reads fetched, new, dropped (AC8)', async () => {
    const batch = [doc('https://ac313-ingest.example/a1', 'Lula fala sobre a safra'), doc('https://ac313-ingest.example/a2', 'Congresso vota a pauta'), doc('https://ac313-ingest.example/a3', 'Governo anuncia obras')]
    const { report, logs } = await through(() => Effect.succeed(batch))
    const [rss] = report.sources
    assert.equal(rss.fetched, 3)
    assert.equal(rss.written, 1)
    assert.equal(rss.dropped, 2)
    assert.ok(logs.includes('[rss] fetched 3, new 1, dropped 2'), JSON.stringify(logs))
  })

  it('enriched and failed are appended after dropped, only when non-zero (AC8)', async () => {
    const uri = 'https://ac313-ingest.example/e1'
    await through(() => Effect.succeed([doc(uri, 'Lula fala sobre a safra')]))
    const longer = doc(uri, 'Lula fala sobre a safra e detalha o plano de exportação para os próximos meses')
    const { logs } = await through(() => Effect.succeed([longer, doc('https://ac313-ingest.example/e2', 'Governo anuncia obras')]))
    assert.ok(logs.includes('[rss] fetched 2, new 0, dropped 1, enriched 1'), JSON.stringify(logs))
    assert.ok(!logs.some((line) => line.includes('failed')))
  })

  it('a source that fails or is unknown reports dropped 0 (AC8)', async () => {
    const { report } = await through(() => Effect.fail(new RssError({ message: 'boom' })) as unknown as Effect.Effect<RawDoc[], never>, ['rss', 'no-such-source'])
    assert.deepEqual(report.sources.map((s) => s.dropped), [0, 0])
  })

  it('a source returning only untracked docs reports new 0, dropped N and writes no row (AC8)', async () => {
    const only = [doc('https://ac313-ingest.example/u1', 'Congresso vota a pauta'), doc('https://ac313-ingest.example/u2', 'Governo anuncia obras')]
    const { report, logs } = await through(() => Effect.succeed(only))
    assert.equal(report.sources[0].written, 0)
    assert.equal(report.sources[0].dropped, 2)
    assert.equal(report.sources[0].fetched, 2)
    assert.ok(logs.includes('[rss] fetched 2, new 0, dropped 2'), JSON.stringify(logs))
    assert.equal(await storedCount(only.map((d) => d.uri)), 0)
  })

  it('dropped docs do not count toward ANALYZE_MIN_DOCS and the line carries written only (AC9)', async () => {
    const mixed = (tag: string, trackedCount: number) => [
      ...Array.from({ length: trackedCount }, (_, i) => doc(`https://ac313-ingest.example/${tag}-t${i}`, `Lula fala sobre o tema ${tag} ${i}`)),
      ...Array.from({ length: 4 }, (_, i) => doc(`https://ac313-ingest.example/${tag}-n${i}`, `Governo anuncia obras ${tag} ${i}`)),
    ]
    await withEnv({ ANALYZE_MIN_DOCS: '3' }, async () => {
      const { logs } = await through(() => Effect.succeed(mixed('below', 2)))
      assert.ok(logs.some((line) => /^skipped analyze: 2 new docs/.test(line)), JSON.stringify(logs))
      assert.ok(!logs.some((line) => line.startsWith('analyzed ')), 'two written plus four dropped must not reach the floor of three')
    })
    await withEnv({ ANALYZE_MIN_DOCS: '3' }, async () => {
      const { logs } = await through(() => Effect.succeed(mixed('above', 3)))
      assert.ok(logs.some((line) => /^analyzed .*after 3 new docs/.test(line)), JSON.stringify(logs))
    })
  })

  it('a doc a collector returns older than 21 days is written and trimmed by the same run (collector lookbacks stay wider than retention)', async () => {
    const old: RawDoc = { ...doc('https://ac313-lookback.example/d26', 'Lula discute a reforma tributária'), publishedAt: new Date(Date.now() - 26 * 86_400_000).toISOString() }
    const fresh: RawDoc = { ...doc('https://ac313-lookback.example/d2', 'Lula discute a reforma administrativa'), publishedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }
    const { report, logs } = await through(() => Effect.succeed([old, fresh]))
    assert.equal(report.sources[0].written, 2)
    assert.equal(report.sources[0].dropped, 0)
    assert.ok(logs.includes('[rss] fetched 2, new 2, dropped 0'), JSON.stringify(logs))
    assert.equal(await storedCount([old.uri]), 0)
    assert.equal(await storedCount([fresh.uri]), 1)
    assert.ok(report.deleted >= 1)
  })

  it('retention deletes a doc aged 22 days, keeps one aged 20 days and logs the 21-day horizon (AC19)', async () => {
    const aged = (uri: string, days: number): RawDoc => ({ ...doc(uri, 'Lula discute a reforma tributária'), publishedAt: new Date(Date.now() - days * 86_400_000).toISOString() })
    const twenty = aged('https://ac313-retention.example/d20', 20)
    const twentyTwo = aged('https://ac313-retention.example/d22', 22)
    assert.equal(await insertDocP(twenty, persons), true)
    assert.equal(await insertDocP(twentyTwo, persons), true)
    const { report, logs } = await through(() => Effect.succeed([]))
    assert.equal(await storedCount([twentyTwo.uri]), 0)
    assert.equal(await storedCount([twenty.uri]), 1)
    assert.ok(report.deleted >= 1)
    assert.ok(logs.includes(`retention: deleted ${report.deleted} docs older than 21 days`), JSON.stringify(logs))
  })
})
