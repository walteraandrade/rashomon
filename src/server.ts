import { Hono, type Context } from 'hono'
import { serve } from '@hono/node-server'
import personsSeed from '../seed.json' with { type: 'json' }
import { CACHE_TAG, cacheControl, NO_STORE } from './cache.js'
import { db, migrateP } from './db.js'
import { agendaFor, attentionFor, candidatesFor, comentionFor, compareBridgesFor, compareFor, docsFor, graphFor, lensBridgesFor, lensesFor, persistenceFor, risingFor, sourcesFor, testimonyFor, timelineFor, toneFor, weekFor } from './graph.js'
import { measure, perfEnabled, perfLine, perfLogEnabled, round, serverTiming } from './perf.js'
import type { Person } from './types.js'
import { eligibleKey, lookup, warmStoreFromEnv, type WarmReader, type WarmRoute } from './warmstore.js'
import {
  parseAgendaQuery,
  parseBridgeIds,
  parseAttentionQuery,
  parseCandidatesQuery,
  parseComentionQuery,
  parseCompareQuery,
  parseDocsQuery,
  parseLensesQuery,
  parsePersistenceQuery,
  parseQuery,
  parseRisingQuery,
  parseTestimonyQuery,
  parseTimelineQuery,
  parseToneQuery,
  parseWeekQuery,
} from './query.js'

const port = Number(process.env.PORT ?? 3210)
export const app = new Hono<{ Variables: { person: Person } }>()

const seedById = new Map<string, Person>((personsSeed as Person[]).map((p) => [p.id, p]))

// party/office/uf live only in seed.json (see camaraId/senadoId precedent); wikidata never
// leaves it. seedMap defaults to the real seed so a test can hand withSeedFields a synthetic one.
export const withSeedFields = (row: Pick<Person, 'id' | 'name' | 'aliases'>, seedMap = seedById): Person => {
  const seed = seedMap.get(row.id)
  if (!seed) return row
  return {
    ...row,
    ...(seed.party ? { party: seed.party } : {}),
    ...(seed.office ? { office: seed.office } : {}),
    ...(seed.uf ? { uf: seed.uf } : {}),
  }
}

// PERF=1: one JSON line per request, x-perf-* and server-timing headers; does not alter
// response bytes.
if (perfEnabled)
  app.use('/api/*', async (c, next) => {
    const { ms, sql, dbMs } = await measure(next)
    c.header('x-perf-total-ms', String(round(ms)))
    c.header('x-perf-db-ms', String(round(dbMs)))
    c.header('x-perf-sql-count', String(sql))
    c.header('server-timing', serverTiming({ ms, sql, dbMs }))
    if (perfLogEnabled) console.log(perfLine({ method: c.req.method, path: c.req.path, query: new URL(c.req.url).search.slice(1), status: c.res.status, ms, sql, dbMs }))
  })

// Shared cache headers for every /api/* route, including 404s.
app.use('/api/*', async (c, next) => {
  await next()
  const control = cacheControl({ method: c.req.method, path: c.req.path, status: c.res.status })
  c.header('cache-control', control)
  if (control !== NO_STORE) c.header('vercel-cache-tag', CACHE_TAG)
})

app.get('/api/people', async (c) => {
  const { rows } = await db.query<Person>(`select id, name, aliases from persons order by name`)
  return c.json(rows.map((r) => withSeedFields(r)))
})

// Every /api/people/:id/* route needs the same lookup and the same 404 shape.
app.use('/api/people/:id/*', async (c, next) => {
  const { rows } = await db.query<Person>(`select id, name, aliases from persons where id = $1`, [c.req.param('id')])
  if (!rows[0]) return c.json({ error: 'person not found' }, 404)
  c.set('person', rows[0])
  await next()
})

// Warm recortes are answered from a store outside Postgres (src/materialize.ts writes it) when its
// entry was built against the scope's current built_at; any miss runs the live statement, unless
// the caller asked for the store alone (`pnpm warm`), which turns it into a 503.
let warmStore: WarmReader | null = warmStoreFromEnv(process.env)
export const setWarmStore = (store: WarmReader | null) => {
  warmStore = store
}

const warmed = async <Q extends { days: number }>(c: Context<{ Variables: { person: Person } }>, route: WarmRoute, q: Q, live: (person: Person, q: Q) => Promise<unknown>) => {
  const key = warmStore ? eligibleKey(route, q) : null
  if (!warmStore || !key) return c.json(await live(c.get('person'), q))
  const found = await lookup(warmStore, { personId: c.get('person').id, route, key, days: q.days })
  c.header('x-warm-store', found.state)
  if (found.body !== null) return c.body(found.body, 200, { 'content-type': 'application/json' })
  if (c.req.header('x-warm-store-only') === '1') return c.json({ error: 'warm store miss' }, 503)
  return c.json(await live(c.get('person'), q))
}

app.get('/api/people/:id/graph', (c) => warmed(c, 'graph', parseQuery(c.req.query()), (p, q) => graphFor(p, q)))
app.get('/api/people/:id/sources', (c) => warmed(c, 'sources', parseQuery(c.req.query()), sourcesFor))
app.get('/api/people/:id/docs', async (c) => {
  const q = parseDocsQuery(c.req.query(), c.req.param('id'))
  // Existence against the live persons table, the /api/compare pattern below, not seed.json.
  if (q.with !== '') {
    const { rows } = await db.query(`select 1 from persons where id = $1`, [q.with])
    if (!rows[0]) q.with = ''
  }
  return c.json(await docsFor(c.get('person'), q))
})
app.get('/api/people/:id/timeline', async (c) => c.json(await timelineFor(c.get('person'), parseTimelineQuery(c.req.query()))))
app.get('/api/people/:id/week', async (c) => c.json(await weekFor(c.get('person'), parseWeekQuery(c.req.query()))))
app.get('/api/people/:id/rising', async (c) => c.json(await risingFor(c.get('person'), parseRisingQuery(c.req.query()))))
app.get('/api/people/:id/testimony', (c) => warmed(c, 'testimony', parseTestimonyQuery(c.req.query()), testimonyFor))
app.get('/api/people/:id/lenses', async (c) => c.json(await lensesFor(c.get('person'), parseLensesQuery(c.req.query()))))
app.get('/api/people/:id/lenses/bridges', async (c) =>
  c.json(await lensBridgesFor(c.get('person'), parseLensesQuery(c.req.query()), parseBridgeIds(c.req.query('ids')))),
)
app.get('/api/people/:id/attention', async (c) => c.json(await attentionFor(c.get('person'), parseAttentionQuery(c.req.query()))))
app.get('/api/people/:id/persistence', async (c) =>
  c.json(await persistenceFor(c.get('person'), parsePersistenceQuery(c.req.query()))),
)

// Not nested under /people/:id: spans two specific people.
const comparePair = async (aRaw: string | undefined, bRaw: string | undefined) => {
  const aId = (aRaw ?? '').trim()
  const bId = (bRaw ?? '').trim()
  const { rows } = await db.query<Person>(`select id, name, aliases from persons where id = any($1::text[])`, [[aId, bId]])
  const byId = new Map(rows.map((p) => [p.id, p]))
  const a = byId.get(aId)
  const b = byId.get(bId)
  return a && b ? { a, b } : null
}

app.get('/api/compare', async (c) => {
  const pair = await comparePair(c.req.query('a'), c.req.query('b'))
  if (!pair) return c.json({ error: 'person not found' }, 404)
  return c.json(await compareFor(pair.a, pair.b, parseCompareQuery(c.req.query())))
})

// The ruler paints from /api/compare first; this scores its terms afterwards so the figure never waits on it.
app.get('/api/compare/bridges', async (c) => {
  const pair = await comparePair(c.req.query('a'), c.req.query('b'))
  if (!pair) return c.json({ error: 'person not found' }, 404)
  return c.json(await compareBridgesFor(pair.a, pair.b, parseCompareQuery(c.req.query()), parseBridgeIds(c.req.query('ids'))))
})

app.get('/api/tone', async (c) => c.json(await toneFor(parseToneQuery(c.req.query()))))
app.get('/api/agenda', async (c) => c.json(await agendaFor(parseAgendaQuery(c.req.query()))))
app.get('/api/candidates', async (c) => c.json(await candidatesFor(parseCandidatesQuery(c.req.query()))))
app.get('/api/comention', async (c) => c.json(await comentionFor(parseComentionQuery(c.req.query())))) // spans every tracked person, like /api/tone

// Importing `app` in tests never binds a port or migrates; only the entrypoint does.
if (import.meta.url === `file://${process.argv[1]}`) {
  await migrateP()
  serve({ fetch: app.fetch, port }, () => console.log(`http://localhost:${port}`))
}
