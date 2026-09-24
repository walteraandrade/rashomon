import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { Effect, Exit, Layer } from 'effect'
import { TestConsole } from 'effect/testing'
import { FetchHttpClient, type HttpClient } from 'effect/unstable/http'
import { SqlClient, SqlError } from 'effect/unstable/sql'
import { db, runSql } from '../src/db.js'
import { fetchClient } from '../src/http.js'
import { collectors, defaultSources } from '../src/collectors/index.js'
import { RssError } from '../src/collectors/rss.js'
import { ingest, IngestFailure } from '../src/ingest.js'
import type { RawDoc, Source } from '../src/types.js'
import { persons, reseed } from './fixture.js'
import { failingSql, failureOf, fakeFetch } from './effect.js'
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

const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient | SqlClient.SqlClient>, layer: Layer.Layer<HttpClient.HttpClient | SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    const logs = (yield* TestConsole.logLines).map(String)
    const errors = (yield* TestConsole.errorLines).map(String)
    return { exit, logs, errors }
  }).pipe(Effect.provide(layer))

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
