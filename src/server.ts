import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { cacheControl } from './cache.js'
import { db, migrate } from './db.js'
import { candidatesFor, compareFor, docsFor, graphFor, risingFor, sourcesFor, testimonyFor, timelineFor, toneFor } from './graph.js'
import { measure, perfEnabled, perfLine, perfLogEnabled, round } from './perf.js'
import type { Person } from './types.js'
import {
  parseCandidatesQuery,
  parseCompareQuery,
  parseDocsQuery,
  parseQuery,
  parseRisingQuery,
  parseTestimonyQuery,
  parseTimelineQuery,
  parseToneQuery,
} from './query.js'

const port = Number(process.env.PORT ?? 3210)
export const app = new Hono<{ Variables: { person: Person } }>()

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

// The whole API is public, read-only and changes only when `pnpm push` copies a new local
// database up, so a shared cache in front of it serves most reads without running a function
// or touching Postgres. Registered before every /api route so it also covers the 404s.
app.use('/api/*', async (c, next) => {
  await next()
  c.header('cache-control', cacheControl({ method: c.req.method, path: c.req.path, status: c.res.status }))
})

app.get('/api/people', async (c) => {
  const { rows } = await db.query<Person>(`select id, name, aliases from persons order by name`)
  return c.json(rows)
})

// Every /api/people/:id/* route needs the same lookup and the same 404 shape.
app.use('/api/people/:id/*', async (c, next) => {
  const { rows } = await db.query<Person>(`select id, name, aliases from persons where id = $1`, [c.req.param('id')])
  if (!rows[0]) return c.json({ error: 'person not found' }, 404)
  c.set('person', rows[0])
  await next()
})

app.get('/api/people/:id/graph', async (c) => c.json(await graphFor(c.get('person'), parseQuery(c.req.query()))))
app.get('/api/people/:id/sources', async (c) => c.json(await sourcesFor(c.get('person'), parseQuery(c.req.query()))))
app.get('/api/people/:id/docs', async (c) => c.json(await docsFor(c.get('person'), parseDocsQuery(c.req.query()))))
app.get('/api/people/:id/timeline', async (c) => c.json(await timelineFor(c.get('person'), parseTimelineQuery(c.req.query()))))
app.get('/api/people/:id/rising', async (c) => c.json(await risingFor(c.get('person'), parseRisingQuery(c.req.query()))))
app.get('/api/people/:id/testimony', async (c) => c.json(await testimonyFor(c.get('person'), parseTestimonyQuery(c.req.query()))))

// Not nested under /people/:id, like /api/tone and /api/candidates: it spans two specific
// people, neither of which is "the" resource. `a` is resolved before `b`, so if both are
// invalid the body cannot distinguish which -- the same granularity /people/:id/* already
// gives for one id.
app.get('/api/compare', async (c) => {
  const aId = (c.req.query('a') ?? '').trim()
  const bId = (c.req.query('b') ?? '').trim()
  const { rows } = await db.query<Person>(`select id, name, aliases from persons where id = any($1::text[])`, [[aId, bId]])
  const byId = new Map(rows.map((p) => [p.id, p]))
  const a = byId.get(aId)
  if (!a) return c.json({ error: 'person not found' }, 404)
  const b = byId.get(bId)
  if (!b) return c.json({ error: 'person not found' }, 404)
  return c.json(await compareFor(a, b, parseCompareQuery(c.req.query())))
})

// Not nested under /people/:id: it spans every tracked person at once.
app.get('/api/tone', async (c) => c.json(await toneFor(parseToneQuery(c.req.query()))))

// Names nobody tracks yet, ranked by document count; the human promotes them via seed.json.
app.get('/api/candidates', async (c) => c.json(await candidatesFor(parseCandidatesQuery(c.req.query()))))

// The radial atlas is the current UI; index.html stays reachable as the legacy one.
app.get('/', serveStatic({ path: './public/design-5.html' }))
app.use('/*', serveStatic({ root: './public' }))

// Guarded so importing `app` in tests (to call app.request(...) directly) never binds a
// real port or migrates a real DATA_DIR; only running this file as the entrypoint (`pnpm dev`) does.
if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate()
  serve({ fetch: app.fetch, port }, () => console.log(`http://localhost:${port}`))
}
