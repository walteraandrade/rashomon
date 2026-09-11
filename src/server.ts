import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { cacheControl } from './cache.js'
import { db, migrate } from './db.js'
import { candidatesFor, compareFor, docsFor, graphFor, risingFor, sourcesFor, testimonyFor, timelineFor, toneFor, weekFor } from './graph.js'
import { HTML_PATHS, SECURITY_HEADERS } from './headers.js'
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
  parseWeekQuery,
} from './query.js'

const port = Number(process.env.PORT ?? 3210)
export const app = new Hono<{ Variables: { person: Person } }>()

// PERF=1: one JSON line per request, x-perf-* headers; does not alter response bytes.
if (perfEnabled)
  app.use('/api/*', async (c, next) => {
    const { ms, sql, dbMs } = await measure(next)
    c.header('x-perf-total-ms', String(round(ms)))
    c.header('x-perf-db-ms', String(round(dbMs)))
    c.header('x-perf-sql-count', String(sql))
    if (perfLogEnabled) console.log(perfLine({ method: c.req.method, path: c.req.path, query: new URL(c.req.url).search.slice(1), status: c.res.status, ms, sql, dbMs }))
  })

// Shared cache headers for every /api/* route, including 404s.
app.use('/api/*', async (c, next) => {
  await next()
  c.header('cache-control', cacheControl({ method: c.req.method, path: c.req.path, status: c.res.status }))
})

// Security headers for HTML pages served by this process (set after next() so serveStatic's
// own Response is already built).
for (const path of HTML_PATHS)
  app.use(path, async (c, next) => {
    await next()
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(key, value)
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
app.get('/api/people/:id/week', async (c) => c.json(await weekFor(c.get('person'), parseWeekQuery(c.req.query()))))
app.get('/api/people/:id/rising', async (c) => c.json(await risingFor(c.get('person'), parseRisingQuery(c.req.query()))))
app.get('/api/people/:id/testimony', async (c) => c.json(await testimonyFor(c.get('person'), parseTestimonyQuery(c.req.query()))))

// Not nested under /people/:id: spans two specific people.
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

app.get('/api/tone', async (c) => c.json(await toneFor(parseToneQuery(c.req.query()))))
app.get('/api/candidates', async (c) => c.json(await candidatesFor(parseCandidatesQuery(c.req.query()))))

app.get('/', serveStatic({ path: './public/design-5.html' }))
app.use('/*', serveStatic({ root: './public' }))

// Importing `app` in tests never binds a port or migrates; only the entrypoint does.
if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate()
  serve({ fetch: app.fetch, port }, () => console.log(`http://localhost:${port}`))
}
