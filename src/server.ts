import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { db, migrate } from './db.js'
import { docsFor, graphFor, risingFor, sourcesFor, timelineFor, toneFor } from './graph.js'
import type { Person } from './types.js'
import { parseDocsQuery, parseQuery, parseRisingQuery, parseTimelineQuery, parseToneQuery } from './query.js'

const port = Number(process.env.PORT ?? 3210)
const app = new Hono()

app.get('/api/people', async (c) => {
  const { rows } = await db.query<Person>(`select id, name, aliases from persons order by name`)
  return c.json(rows)
})

app.get('/api/people/:id/graph', async (c) => {
  const { rows } = await db.query<Person>(`select id, name, aliases from persons where id = $1`, [c.req.param('id')])
  if (!rows[0]) return c.json({ error: 'person not found' }, 404)
  return c.json(await graphFor(rows[0], parseQuery(c.req.query())))
})

app.get('/api/people/:id/sources', async (c) => {
  const { rows } = await db.query<Person>(`select id, name, aliases from persons where id = $1`, [c.req.param('id')])
  if (!rows[0]) return c.json({ error: 'person not found' }, 404)
  return c.json(await sourcesFor(rows[0], parseQuery(c.req.query())))
})

app.get('/api/people/:id/docs', async (c) => {
  const { rows } = await db.query<Person>(`select id, name, aliases from persons where id = $1`, [c.req.param('id')])
  if (!rows[0]) return c.json({ error: 'person not found' }, 404)
  return c.json(await docsFor(rows[0], parseDocsQuery(c.req.query())))
})

app.get('/api/people/:id/timeline', async (c) => {
  const { rows } = await db.query<Person>(`select id, name, aliases from persons where id = $1`, [c.req.param('id')])
  if (!rows[0]) return c.json({ error: 'person not found' }, 404)
  return c.json(await timelineFor(rows[0], parseTimelineQuery(c.req.query())))
})

app.get('/api/people/:id/rising', async (c) => {
  const { rows } = await db.query<Person>(`select id, name, aliases from persons where id = $1`, [c.req.param('id')])
  if (!rows[0]) return c.json({ error: 'person not found' }, 404)
  return c.json(await risingFor(rows[0], parseRisingQuery(c.req.query())))
})

// Not nested under /people/:id: it spans every tracked person at once.
app.get('/api/tone', async (c) => c.json(await toneFor(parseToneQuery(c.req.query()))))

app.use('/*', serveStatic({ root: './public' }))

await migrate()
serve({ fetch: app.fetch, port }, () => console.log(`http://localhost:${port}`))
