import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { db, migrate } from './db.js'
import { graphFor, sourcesFor, type GraphQuery } from './graph.js'
import type { Person } from './types.js'

const port = 3210
const app = new Hono()

const int = (v: string | undefined, d: number, lo: number, hi: number) => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

const parseQuery = (q: Record<string, string | undefined>): GraphQuery => ({
  days: int(q.days, 30, 1, 365),
  source: ['bluesky', 'gdelt', 'rss', 'gnews', 'gkg'].includes(q.source ?? '') ? q.source! : 'all',
  domain: /^[a-z0-9.:-]{1,120}$/.test(q.domain ?? '') ? q.domain! : 'all',
  kind: ['hashtag', 'word', 'theme'].includes(q.kind ?? '') ? q.kind! : 'all',
  limit: int(q.limit, 40, 1, 200),
  min: int(q.min, 2, 1, 1000),
  sort: q.sort === 'pmi' ? 'pmi' : 'count',
})

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

app.use('/*', serveStatic({ root: './public' }))

await migrate()
serve({ fetch: app.fetch, port }, () => console.log(`http://localhost:${port}`))
