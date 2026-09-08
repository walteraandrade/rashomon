import { Hono } from 'hono'
import type { Context } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { people, reads } from './cache.js'
import { db, migrate } from './db.js'
import { candidatesFor, docsFor, graphFor, risingFor, sourcesFor, testimonyFor, timelineFor, toneFor } from './graph.js'
import { measure, perfEnabled, perfLine, perfLogEnabled, round } from './perf.js'
import type { Person } from './types.js'
import {
  cacheKey,
  parseCandidatesQuery,
  parseDocsQuery,
  parseQuery,
  parseRisingQuery,
  parseTestimonyQuery,
  parseTimelineQuery,
  parseToneQuery,
} from './query.js'

const port = Number(process.env.PORT ?? 3210)
type Env = { Variables: { person: Person } }
export const app = new Hono<Env>()

// Opt-in (PERF=1) and registered before every route so it wraps them all: one JSON line per
// API request plus x-perf-* response headers with wall time, SQL statement count and time
// awaited on PGlite. Headers only, never the body, so payloads stay byte-identical; when
// PERF is unset this middleware does not exist.
if (perfEnabled)
  app.use('/api/*', async (c, next) => {
    const { ms, sql, dbMs } = await measure(next)
    c.header('x-perf-total-ms', String(round(ms)))
    c.header('x-perf-db-ms', String(round(dbMs)))
    c.header('x-perf-sql-count', String(sql))
    if (perfLogEnabled) console.log(perfLine({ method: c.req.method, path: c.req.path, query: new URL(c.req.url).search.slice(1), status: c.res.status, ms, sql, dbMs }))
  })

// The cache holds the serialized body, so a hit answers without touching the database and
// without re-serializing. `application/json` is exactly what c.json() sets, so a hit and a
// miss are byte-identical response and header alike.
const cachedJson = async (c: Context<Env>, key: string, load: () => Promise<unknown>) =>
  c.body(await reads.take(key, async () => JSON.stringify(await load())), 200, { 'content-type': 'application/json' })

type Parser<Q> = (q: Record<string, string | undefined>) => Q

// Two thin wrappers rather than a cache call per route: the key is always built from the
// parsed query, never from the raw one, so no route can accidentally key on a raw string.
const personRoute =
  <Q extends Record<string, unknown>>(route: string, parse: Parser<Q>, load: (person: Person, q: Q) => Promise<unknown>) =>
  (c: Context<Env>) => {
    const person = c.get('person')
    const q = parse(c.req.query())
    return cachedJson(c, cacheKey(route, person.id, q), () => load(person, q))
  }

const globalRoute =
  <Q extends Record<string, unknown>>(route: string, parse: Parser<Q>, load: (q: Q) => Promise<unknown>) =>
  (c: Context<Env>) => {
    const q = parse(c.req.query())
    return cachedJson(c, cacheKey(route, '', q), () => load(q))
  }

app.get('/api/people', (c) =>
  cachedJson(c, cacheKey('people', '', {}), async () => (await db.query<Person>(`select id, name, aliases from persons order by name`)).rows),
)

// Every /api/people/:id/* route needs the same lookup and the same 404 shape. Cached and
// coalesced like the reads below it, so a warm request runs no statement at all.
app.use('/api/people/:id/*', async (c, next) => {
  const id = c.req.param('id')
  const person = await people.take(cacheKey('person', id, {}), async () => {
    const { rows } = await db.query<Person>(`select id, name, aliases from persons where id = $1`, [id])
    return rows[0] ?? null
  })
  if (!person) return c.json({ error: 'person not found' }, 404)
  c.set('person', person)
  await next()
})

app.get('/api/people/:id/graph', personRoute('graph', parseQuery, graphFor))
app.get('/api/people/:id/sources', personRoute('sources', parseQuery, sourcesFor))
app.get('/api/people/:id/docs', personRoute('docs', parseDocsQuery, docsFor))
app.get('/api/people/:id/timeline', personRoute('timeline', parseTimelineQuery, timelineFor))
app.get('/api/people/:id/rising', personRoute('rising', parseRisingQuery, risingFor))
app.get('/api/people/:id/testimony', personRoute('testimony', parseTestimonyQuery, testimonyFor))

// Not nested under /people/:id: it spans every tracked person at once.
app.get('/api/tone', globalRoute('tone', parseToneQuery, toneFor))

// Names nobody tracks yet, ranked by document count; the human promotes them via seed.json.
app.get('/api/candidates', globalRoute('candidates', parseCandidatesQuery, candidatesFor))

// The radial atlas is the current UI; index.html stays reachable as the legacy one.
app.get('/', serveStatic({ path: './public/design-5.html' }))
app.use('/*', serveStatic({ root: './public' }))

// Guarded so importing `app` in tests (to call app.request(...) directly) never binds a
// real port or migrates a real DATA_DIR; only running this file as the entrypoint (`pnpm dev`) does.
if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate()
  serve({ fetch: app.fetch, port }, () => console.log(`http://localhost:${port}`))
}
