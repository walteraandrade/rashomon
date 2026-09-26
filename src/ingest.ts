import { Cause, Console, Data, Effect, Exit, Layer } from 'effect'
import type { HttpClient } from 'effect/unstable/http'
import { SqlClient } from 'effect/unstable/sql'
import personsSeed from '../seed.json' with { type: 'json' }
import { buildGraphAggregates, POST_BUILD_ANALYZED, type AggregateReport } from './aggregate.js'
import { analyzeAfterWrite, analyzeMinDocs, analyzeTables, db, docCount, migrate, runSql, type AnalyzedTable } from './db.js'
import { collectors, defaultSources } from './collectors/index.js'
import { fetchClient } from './http.js'
import { loadPhrases } from './phrases.js'
import { insertDocs, pruneRemoved, upsertPersons } from './store.js'
import type { Collector, Person, Phrases, RawDoc, Source } from './types.js'

export type SourceResult = { name: string; fetched: number; written: number; enriched: number; failed: number; error?: string }
export type IngestReport = {
  removed: string[]
  sources: SourceResult[]
  totalDocs: number
  analyzed: readonly AnalyzedTable[]
  aggregates: AggregateReport
}

export type IngestStage = 'migrate' | 'upsertPersons' | 'pruneRemoved' | 'loadPhrases' | 'docCount' | 'analyzeAfterWrite' | 'buildGraphAggregates' | 'analyzeTables'
export class IngestFailure extends Data.TaggedError('IngestFailure')<{ stage: IngestStage; cause: unknown }> {}

export type IngestOptions = {
  collectors?: Partial<Record<Source, Collector>>
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

type Registry = Partial<Record<Source, Collector>>

// A collector failure or an unknown source name both cost that source alone: logged, `docs = []`, never propagates.
const runSource = (
  name: string,
  registry: Registry,
  ps: Person[],
  lexicon: Phrases,
): Effect.Effect<SourceResult, never, HttpClient.HttpClient | SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const collect = registry[name as Source]
    // Effect.suspend: a collector that throws while building its Effect is that source's failure too.
    const outcome = collect ? yield* Effect.exit(Effect.suspend(() => collect(ps))) : Exit.fail(new Error(`unknown source: ${name}`))
    const docs: RawDoc[] = Exit.isSuccess(outcome) ? outcome.value : []
    const failureMessage = Exit.isFailure(outcome) ? errorMessage(Cause.squash(outcome.cause)) : undefined
    if (failureMessage) yield* Console.error(`[${name}] ${failureMessage}`)
    const { written, enriched, failed } = yield* Effect.orDie(insertDocs(docs, ps, undefined, lexicon))
    // `enriched` is the early warning this project has no other source for: it counts documents
    // whose stored text a feed just replaced with a longer one. A feed that quietly stops filling
    // `content:encoded` shows up here as a number falling to zero, before the atlas gets duller.
    yield* Console.log(`[${name}] fetched ${docs.length}, new ${written}${enriched ? `, enriched ${enriched}` : ''}${failed ? `, failed ${failed}` : ''}`)
    return { name, fetched: docs.length, written, enriched, failed, ...(failureMessage ? { error: failureMessage } : {}) } satisfies SourceResult
  })

export const ingest = (
  persons: Person[],
  names: string[],
  options: IngestOptions = {},
): Effect.Effect<IngestReport, IngestFailure, HttpClient.HttpClient | SqlClient.SqlClient> =>
  Effect.gen(function* () {
    yield* migrate().pipe(Effect.mapError((cause) => new IngestFailure({ stage: 'migrate', cause })))
    const removed = yield* pruneRemoved(persons).pipe(Effect.mapError((cause) => new IngestFailure({ stage: 'pruneRemoved', cause })))
    if (removed.length) yield* Console.log(`removed persons: ${removed.join(', ')}`)
    yield* upsertPersons(persons).pipe(Effect.mapError((cause) => new IngestFailure({ stage: 'upsertPersons', cause })))
    // Read once, before any collector runs: a phrase this run's own docs would justify is
    // tagged by the next `pnpm reindex`, not by this one.
    const lexicon = yield* loadPhrases().pipe(Effect.mapError((cause) => new IngestFailure({ stage: 'loadPhrases', cause })))
    const registry: Registry = { ...collectors, ...options.collectors }
    const sources = yield* Effect.forEach(names, (name) => runSource(name, registry, persons, lexicon), { concurrency: 1 })
    const written = sources.reduce((sum, s) => sum + s.written, 0)
    const totalDocs = yield* docCount().pipe(Effect.mapError((cause) => new IngestFailure({ stage: 'docCount', cause })))
    yield* Console.log(`total docs: ${totalDocs}`)
    const analyzed = yield* analyzeAfterWrite(written).pipe(Effect.mapError((cause) => new IngestFailure({ stage: 'analyzeAfterWrite', cause })))
    yield* Console.log(
      analyzed.length
        ? `analyzed ${analyzed.join(', ')} after ${written} new docs`
        : `skipped analyze: ${written} new docs below ANALYZE_MIN_DOCS=${analyzeMinDocs()}`,
    )
    // The window moves even when nothing new was written, so the aggregates are rebuilt every run.
    const aggregates = yield* Effect.tryPromise({ try: () => buildGraphAggregates(persons), catch: (cause) => new IngestFailure({ stage: 'buildGraphAggregates', cause }) })
    yield* analyzeTables(POST_BUILD_ANALYZED).pipe(Effect.mapError((cause) => new IngestFailure({ stage: 'analyzeTables', cause })))
    yield* Console.log(`graph aggregates: ${aggregates.scopes} scopes, ${aggregates.terms} terms, ${Math.round(aggregates.ms)} ms`)
    return { removed, sources, totalDocs, analyzed, aggregates } satisfies IngestReport
  })

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href

if (isMain) {
  const only = process.argv.slice(2)
  const names = only.length ? only : defaultSources
  // Reuses db.ts's own running connection rather than opening a second one on the same DATA_DIR.
  const sqlClient = await runSql(SqlClient.SqlClient)
  const layer = Layer.merge(fetchClient, Layer.succeed(SqlClient.SqlClient, sqlClient))
  try {
    await Effect.runPromise(Effect.provide(ingest(personsSeed, names), layer))
  } catch (e) {
    console.error(`ingest failed: ${errorMessage(e)}`)
    process.exitCode = 1
  } finally {
    await db.close()
  }
}
