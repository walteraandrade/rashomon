import seedJson from '../seed.json' with { type: 'json' }
import { hasGraphAggregates, queries } from './aggregate.js'
import { db } from './db.js'
import { graphFor, sourcesFor, testimonyFor, type GraphQuery, type LinkRow, type TestimonyQuery } from './graph.js'
import type { Person } from './types.js'
import {
  blobReader,
  entryText,
  memoryWarmStore,
  scopeRow,
  splitEntry,
  warmRecortes,
  type WarmReader,
  type WarmRecorte,
  type WarmWriter,
} from './warmstore.js'
import { blobWriter, realPut, type BlobPut } from './warmstore-blob.js'

export type MaterializeOptions = {
  store: WarmWriter
  reader?: WarmReader
  ifStale?: boolean
  days?: readonly string[]
  log?: (line: string) => void
}

export type MaterializeResult = {
  written: number
  fresh: number
  bytes: number
  largest: { pathname: string; bytes: number } | null
  failures: string[]
  notes: string[]
}

type CoEdge = { a: string; b: string; count: number }

const keptSet = async (days: number, personId: string): Promise<Set<string>> => {
  const { rows } = await db.query<{ kind: string; term: string }>(
    `select kind, term from graph_terms where days = $1 and source = 'all' and person_id = $2`,
    [days, personId],
  )
  return new Set(rows.map((r) => `${r.kind}:${r.term}`))
}

const edgesOf = async (days: number, personId: string): Promise<CoEdge[]> => {
  const q = queries.communityEdges(days, 'all', personId)
  return (await db.query<CoEdge>(q.text, q.values)).rows
}

// The build's own edges, sliced to the pairs whose two ends are both nodes of the graph; a and b
// are already oriented like linksQuery's least/greatest, in the same (s, t) order.
const sliceLinks = (edges: CoEdge[], ids: string[]): LinkRow[] => {
  const wanted = new Set(ids)
  return edges.filter((e) => wanted.has(e.a) && wanted.has(e.b)).map((e) => ({ s: e.a, t: e.b, count: e.count }))
}

const differing = async (reader: WarmReader, group: WarmRecorte[], builtAt: string): Promise<WarmRecorte[]> => {
  const stale: WarmRecorte[] = []
  for (const r of group) {
    const text = await reader.get(r.pathname, builtAt).catch(() => null)
    if (splitEntry(text ?? '')?.key !== builtAt) stale.push(r)
  }
  return stale
}

const nullReader: WarmReader = { get: async () => null }

export const materialize = async (persons: Person[], opts: MaterializeOptions): Promise<MaterializeResult> => {
  const log = opts.log ?? (() => undefined)
  const reader = opts.reader ?? nullReader
  const result: MaterializeResult = { written: 0, fresh: 0, bytes: 0, largest: null, failures: [], notes: [] }
  const note = (line: string) => (result.notes.push(line), log(line))
  const fail = (line: string) => (result.failures.push(line), log(line))
  const recortes = warmRecortes(persons, opts.days)

  for (const person of persons) {
    for (const days of new Set(recortes.filter((r) => r.personId === person.id).map((r) => r.days))) {
      const label = `${person.id} ${days}d`
      try {
        const scope = await scopeRow(person.id, days)
        if (!scope) {
          note(`${label}: no graph_scopes row, skipped`)
          continue
        }
        let wanted = recortes.filter((r) => r.personId === person.id && r.days === days)
        if (opts.ifStale) {
          wanted = await differing(reader, wanted, scope.built_at)
          if (!wanted.length) {
            result.fresh += 1
            continue
          }
        }
        let kept = new Set<string>()
        let edges: CoEdge[] = []
        if (wanted.some((r) => r.route === 'graph')) {
          kept = await keptSet(days, person.id)
          if (kept.size === 0 && scope.about > 0) {
            note(`${label}: graph_scopes has ${scope.about} documents but graph_terms is empty, graph entry skipped`)
            wanted = wanted.filter((r) => r.route !== 'graph')
          } else edges = await edgesOf(days, person.id)
        }
        for (const r of wanted) {
          try {
            const body =
              r.route === 'graph'
                ? await graphFor(person, r.parsed as GraphQuery, (ids) => sliceLinks(edges, ids))
                : r.route === 'sources'
                  ? await sourcesFor(person, r.parsed as GraphQuery)
                  : await testimonyFor(person, r.parsed as TestimonyQuery)
            if (r.route === 'graph') {
              const outside = (body as Awaited<ReturnType<typeof graphFor>>).nodes.find((n) => !kept.has(n.id))
              if (outside) {
                note(`${label}: graph node ${outside.id} is not in the kept set, graph entry skipped`)
                continue
              }
            }
            const text = entryText(scope.built_at, JSON.stringify(body))
            await opts.store.put(r.pathname, text)
            const bytes = Buffer.byteLength(text)
            result.written += 1
            result.bytes += bytes
            if (!result.largest || bytes > result.largest.bytes) result.largest = { pathname: r.pathname, bytes }
          } catch (err) {
            fail(`${label} ${r.route}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      } catch (err) {
        fail(`${label}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  return result
}

export type MainDeps = { put?: BlobPut; reader?: WarmReader; fetch?: typeof fetch; log?: (line: string) => void }

// Returns the exit code. Reads persons and graph_scopes through the module-level db, like the
// routes; it never migrates, since it only reads tables a prior migrate or ingest created.
export const main = async (argv: string[], env: Record<string, string | undefined>, deps: MainDeps = {}): Promise<number> => {
  const log = deps.log ?? console.log
  const dryRun = argv.includes('--dry-run')
  const ifStale = argv.includes('--if-stale')
  const token = (env.BLOB_READ_WRITE_TOKEN ?? '').trim()
  const base = (env.WARM_STORE_URL ?? '').trim()
  if (!token && !dryRun) {
    log('no warm store configured, skipping')
    return 0
  }
  if (!(await hasGraphAggregates())) {
    log('no graph aggregates built (run pnpm aggregate first), nothing written')
    return 1
  }
  const known = new Set((seedJson as Person[]).map((p) => p.id))
  const { rows } = await db.query<Person>(`select id, name, aliases from persons order by name`)
  const persons = rows.filter((p) => known.has(p.id))

  const memory = memoryWarmStore()
  const store: WarmWriter = dryRun ? memory : blobWriter(deps.put ?? realPut, token)
  const reader: WarmReader = dryRun ? memory : (deps.reader ?? (base ? blobReader(base, deps.fetch) : nullReader))
  if (ifStale && !dryRun && !deps.reader && !base) log('WARM_STORE_URL is unset: every stored key reads as missing, rewriting everything')

  const result = await materialize(persons, { store, reader, ifStale, log })
  const largest = result.largest ? `${result.largest.pathname} (${result.largest.bytes} B)` : 'none'
  log(
    `${dryRun ? 'dry run: would write' : 'materialized'} ${result.written} entries, ${result.bytes} B, largest ${largest}` +
      `${ifStale ? `, ${result.fresh} windows already up to date` : ''}, ${result.failures.length} failed`,
  )
  return result.failures.length ? 1 : 0
}

const run = async () => {
  try {
    process.exitCode = await main(process.argv.slice(2), process.env)
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    await db.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await run()
