import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { db, migrate } from './db.js'
import {
  docsFor,
  graphFor,
  risingFor,
  sourcesFor,
  timelineFor,
  type DocsQuery,
  type GraphQuery,
  type RisingQuery,
  type TimelineQuery,
} from './graph.js'
import { normalize } from './extract.js'
import type { Person } from './types.js'

const port = Number(process.env.PORT ?? 3210)
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

const parseDocsQuery = (q: Record<string, string | undefined>): DocsQuery => ({
  term: normalize((q.term ?? '').trim()),
  kind: ['hashtag', 'word', 'theme'].includes(q.kind ?? '') ? q.kind! : 'all',
  days: int(q.days, 30, 1, 365),
  source: ['bluesky', 'gdelt', 'rss', 'gnews', 'gkg'].includes(q.source ?? '') ? q.source! : 'all',
  domain: /^[a-z0-9.:-]{1,120}$/.test(q.domain ?? '') ? q.domain! : 'all',
  limit: int(q.limit, 50, 1, 200),
  offset: int(q.offset, 0, 0, 1_000_000),
})

const parseRisingQuery = (q: Record<string, string | undefined>): RisingQuery => ({
  days: int(q.days, 7, 1, 365),
  baseline: int(q.baseline, 30, 1, 365),
  source: ['bluesky', 'gdelt', 'rss', 'gnews', 'gkg'].includes(q.source ?? '') ? q.source! : 'all',
  domain: /^[a-z0-9.:-]{1,120}$/.test(q.domain ?? '') ? q.domain! : 'all',
  kind: ['hashtag', 'word', 'theme'].includes(q.kind ?? '') ? q.kind! : 'all',
  limit: int(q.limit, 20, 1, 100),
  min: int(q.min, 3, 1, 1000),
})

const parseTimelineQuery = (q: Record<string, string | undefined>): TimelineQuery => ({
  term: normalize((q.term ?? '').trim()),
  kind: ['hashtag', 'word', 'theme'].includes(q.kind ?? '') ? q.kind! : 'all',
  days: int(q.days, 30, 1, 365),
  source: ['bluesky', 'gdelt', 'rss', 'gnews', 'gkg'].includes(q.source ?? '') ? q.source! : 'all',
  domain: /^[a-z0-9.:-]{1,120}$/.test(q.domain ?? '') ? q.domain! : 'all',
  bucket: q.bucket === 'day' ? 'day' : 'week',
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

app.use('/*', serveStatic({ root: './public' }))

await migrate()
serve({ fetch: app.fetch, port }, () => console.log(`http://localhost:${port}`))
