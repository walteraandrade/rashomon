import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { db, migrate } from './db.js'
import { candidatesFor, docsFor, graphFor, risingFor, sourcesFor, testimonyFor, timelineFor, toneFor } from './graph.js'
import type { Person } from './types.js'
import {
  parseCandidatesQuery,
  parseDocsQuery,
  parseQuery,
  parseRisingQuery,
  parseTestimonyQuery,
  parseTimelineQuery,
  parseToneQuery,
} from './query.js'

const port = Number(process.env.PORT ?? 3210)
export const app = new Hono<{ Variables: { person: Person } }>()

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
