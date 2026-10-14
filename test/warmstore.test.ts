import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { buildGraphAggregates } from '../src/aggregate.js'
import { db, migrateP } from '../src/db.js'
import { parseQuery, parseTestimonyQuery } from '../src/query.js'
import { app, setWarmStore } from '../src/server.js'
import { params } from '../src/ui/api.js'
import { warmPaths, WARM_DAYS } from '../src/warm.js'
import { materialize } from '../src/materialize.js'
import { upsertPersonsP } from '../src/store.js'
import { entryText, pgWarmStore, splitEntry, storeKey, warmRecortes, type WarmReader } from '../src/warmstore.js'
import { persons, seed } from './fixture.js'
import { built, dbPersons, materialized, recordStatements, restore, storedEntries } from './warmstore-helpers.js'
import './close.js'

const ids = persons.map((p) => ({ id: p.id }))
const warmPathsOf = (list = ids) => warmPaths(list).filter((p) => p !== '/api/people')
const routeOf = (path: string) => path.split('?')[0].split('/').pop()!

const request = async (path: string, headers: Record<string, string> = {}) => {
  const res = await app.request(path, { headers })
  return { status: res.status, text: await res.text(), headers: res.headers }
}

const live = async (path: string) => {
  setWarmStore(null)
  return request(path)
}

const ROUTES = ['graph', 'sources', 'testimony'] as const
const pathOf = (person: string, route: (typeof ROUTES)[number], days: 7 | 21) =>
  warmPathsOf([{ id: person }]).find((p) => routeOf(p) === route && new URL(p, 'http://warm.local').searchParams.get('days') === String(days))!
const lulaPath = (route: (typeof ROUTES)[number], days: 7 | 21) => pathOf('lula', route, days)
const pathnameOf = (path: string) => warmRecortes(ids).find((r) => r.path === path)!.pathname
const served = async (store: WarmReader | null, path: string, headers: Record<string, string> = {}) => {
  setWarmStore(store)
  let res!: Awaited<ReturnType<typeof request>>
  const statements = await recordStatements(async () => void (res = await request(path, headers)))
  return { res, statements }
}
const touches = (statements: string[], table: RegExp) => statements.filter((s) => table.test(s)).length

const PERSON = /from persons where id = \$1/
const SCOPE = /from graph_scopes/
const ENTRY = /^select body from warm_entries where pathname = \$1$/

after(() => setWarmStore(null))

describe('the store entries', () => {
  before(seed)

  it('are derived from warmPaths, one per stored route, window and person', () => {
    const recortes = warmRecortes(ids)
    assert.equal(recortes.length, persons.length * WARM_DAYS.length * 3)
    assert.equal(recortes.length, warmPathsOf().length)
    assert.deepEqual(recortes.map((r) => r.path), warmPathsOf())
    assert.equal(new Set(recortes.map((r) => r.pathname)).size, recortes.length)
    for (const p of ids) {
      const own = recortes.filter((r) => r.personId === p.id)
      assert.equal(new Set(own.map((r) => r.key)).size, own.length, 'a person\'s own keys never collide')
    }
    assert.equal(warmRecortes(ids, ['7']).length, recortes.length / 2)
    assert.deepEqual([...new Set(recortes.map((r) => r.days))].sort((a, b) => a - b), [7, 21], 'warm recortes cover the two windows and no retired one')
    assert.ok(recortes.every((r) => !/days=(30|60|365)\b/.test(r.path)))
  })

  it('materialising writes exactly those pathnames into warm_entries, bolsonaro\'s empty windows included', async () => {
    await materialized()
    const entries = await storedEntries()
    assert.deepEqual([...entries.keys()].sort(), warmRecortes(ids).map((r) => r.pathname).sort())
    const empty = JSON.parse(splitEntry(entries.get(warmRecortes(ids).find((r) => r.personId === 'bolsonaro' && r.route === 'graph' && r.days === 7)!.pathname)!)!.body)
    assert.deepEqual(empty.nodes, [])
    assert.equal(empty.stats.about, 0)
  })
})

describe('the store key', () => {
  it('follows the parser output, not the querystring', () => {
    const base = { days: '7', sort: 'pmi', limit: '18', min: '2', source: 'all', kind: 'word,hashtag,phrase,org', testimony: '1', communities: '1' }
    const key = (q: Record<string, string>, route: 'graph' | 'sources' = 'graph') => storeKey(route, parseQuery(q))
    const reordered = Object.fromEntries(Object.entries(base).reverse())
    assert.equal(key(base), key(reordered))
    const { min: _min, ...noMin } = base
    assert.equal(key(base), key(noMin), 'min=2 is the default')
    assert.notEqual(key(base), key(base, 'sources'))
    const changed: Record<string, string> = { days: '21', source: 'rss', min: '3', limit: '20', sort: 'count', kind: 'word', domain: 'g1.globo.com', lean: 'left', country: 'pt', method: 'stub', testimony: '', communities: '' }
    for (const [name, value] of Object.entries(changed)) {
      const q = { ...base, [name]: value }
      if (name === 'method') q.testimony = '1'
      assert.notEqual(key(q), key(base), `${name}=${value} must change the key`)
    }
  })

  it('is one sha256 of the route and the whole parsed query', () => {
    assert.match(storeKey('graph', parseQuery({})), /^[0-9a-f]{64}$/)
    assert.notEqual(storeKey('testimony', parseTestimonyQuery({})), storeKey('testimony', parseTestimonyQuery({ min: '5' })))
  })

  it('splits an entry at its first line and refuses one without a key line', () => {
    assert.deepEqual(splitEntry(entryText('k', '{"a":1}')), { key: 'k', body: '{"a":1}' })
    assert.equal(splitEntry('{"a":1}'), null)
    assert.equal(splitEntry('\n{}'), null)
  })
})

describe('the Postgres store', () => {
  before(built)
  after(restore)

  const lula = { pathname: 'warm/v1/lula/graph/one.json', personId: 'lula' }
  const insertRow = (pathname: string, person: string, body: string) =>
    db.query(`insert into warm_entries (pathname, person_id, body) values ($1, $2, $3)`, [pathname, person, body])

  it('get returns the stored body for a known pathname and null for an unknown one, each in exactly one select (AC4)', async () => {
    await db.exec(`delete from warm_entries`)
    await insertRow(lula.pathname, 'lula', 'key\n{"stored":true}')
    const calls: (string | null)[] = []
    const statements = await recordStatements(async () => {
      calls.push(await pgWarmStore.get(lula.pathname))
      calls.push(await pgWarmStore.get('warm/v1/lula/graph/unknown.json'))
    })
    assert.deepEqual(calls, ['key\n{"stored":true}', null])
    assert.deepEqual(statements, Array(2).fill('select body from warm_entries where pathname = $1'))
  })

  it('put twice on one pathname keeps one row holding the second body and the given person id (AC5)', async () => {
    await db.exec(`delete from warm_entries`)
    await pgWarmStore.put(lula, 'first')
    await pgWarmStore.put({ ...lula, personId: 'tarcisio' }, 'second')
    const { rows } = await db.query<{ pathname: string; person_id: string; body: string }>(`select pathname, person_id, body from warm_entries`)
    assert.deepEqual(rows, [{ pathname: lula.pathname, person_id: 'tarcisio', body: 'second' }])
  })

  it('put keeps other pathnames of the same person as separate rows (AC5)', async () => {
    await db.exec(`delete from warm_entries`)
    await pgWarmStore.put(lula, 'one\n{}')
    await pgWarmStore.put({ pathname: 'warm/v1/lula/sources/two.json', personId: 'lula' }, 'two\n{}')
    const { rows } = await db.query<{ pathname: string }>(`select pathname from warm_entries order by pathname`)
    assert.deepEqual(rows.map((r) => r.pathname), [lula.pathname, 'warm/v1/lula/sources/two.json'])
  })

  it('deleting a person deletes that person\'s warm_entries rows and no one else\'s (AC3)', async () => {
    await db.exec(`delete from warm_entries`)
    await upsertPersonsP([
      { id: 'warm-gone', name: 'Warm Gone', aliases: ['Warm Gone'] },
      { id: 'warm-stays', name: 'Warm Stays', aliases: ['Warm Stays'] },
    ])
    try {
      await insertRow('warm/v1/warm-gone/graph/a.json', 'warm-gone', 'k\n{}')
      await insertRow('warm/v1/warm-gone/sources/a.json', 'warm-gone', 'k\n{}')
      await insertRow('warm/v1/warm-stays/graph/a.json', 'warm-stays', 'k\n{}')
      await insertRow(lula.pathname, 'lula', 'k\n{}')
      await db.exec(`delete from persons where id = 'warm-gone'`)
      const { rows } = await db.query<{ pathname: string; person_id: string }>(`select pathname, person_id from warm_entries order by pathname`)
      assert.deepEqual(rows, [
        { pathname: lula.pathname, person_id: 'lula' },
        { pathname: 'warm/v1/warm-stays/graph/a.json', person_id: 'warm-stays' },
      ])
    } finally {
      await db.exec(`delete from warm_entries`)
      await db.exec(`delete from persons where id in ('warm-gone', 'warm-stays')`)
    }
  })

  it('rejects a row for a person that does not exist', async () => {
    await assert.rejects(pgWarmStore.put({ pathname: 'warm/v1/nobody/graph/a.json', personId: 'nobody' }, 'k\n{}'))
  })
})

describe('a stored recorte', () => {
  before(built)
  after(restore)

  it('every warm path of every fixture person answers 200 with x-warm-store hit and the live route\'s body, content-type and cache-control, bolsonaro\'s empty windows included (AC6)', async () => {
    await materialized()
    const paths = warmPathsOf()
    assert.equal(paths.length, persons.length * 2 * 3)
    for (const path of paths) {
      setWarmStore(pgWarmStore)
      const stored = await request(path)
      const expected = await live(path)
      assert.equal(stored.status, 200, path)
      assert.equal(stored.headers.get('x-warm-store'), 'hit', path)
      assert.equal(stored.text, expected.text, path)
      assert.equal(stored.headers.get('content-type'), expected.headers.get('content-type'), path)
      assert.equal(stored.headers.get('cache-control'), expected.headers.get('cache-control'), path)
      assert.equal(expected.headers.get('x-warm-store'), null, path)
    }
    setWarmStore(pgWarmStore)
    const empty = JSON.parse((await request(pathOf('bolsonaro', 'graph', 7))).text)
    assert.deepEqual([empty.nodes, empty.links], [[], []])
  })

  it('carries person-less links in at least one graph body, at most C(n,2) of them', async () => {
    await materialized()
    const entries = await storedEntries()
    let personLess = 0
    for (const r of warmRecortes(ids).filter((r) => r.route === 'graph')) {
      const body = JSON.parse(splitEntry(entries.get(r.pathname)!)!.body)
      const extra = body.links.filter((l: { source: string }) => l.source !== `person:${r.personId}`)
      const n = body.nodes.length
      assert.ok(extra.length <= (n * (n - 1)) / 2, `${r.path}: ${extra.length} links among ${n} nodes`)
      personLess += extra.length
    }
    assert.ok(personLess > 0, 'the byte-identity check is not vacuous: some body has a word-to-word link')
  })

  it('answers a hit in three statements, person, graph_scopes, warm_entries, touching neither doc_terms nor graph_terms, and still returns its text once both are emptied (AC7)', async () => {
    await materialized()
    for (const route of ROUTES) {
      const first = await served(pgWarmStore, lulaPath(route, 21))
      assert.equal(first.res.headers.get('x-warm-store'), 'hit', route)
      assert.equal(first.statements.length, 3, `${route}: ${first.statements.map((s) => s.slice(0, 40)).join(' | ')}`)
      assert.match(first.statements[0], PERSON)
      assert.match(first.statements[1], SCOPE)
      assert.match(first.statements[2], ENTRY)
      for (const s of first.statements) assert.doesNotMatch(s, /doc_terms|graph_terms/)
    }
    const path = lulaPath('graph', 7)
    const before = await served(pgWarmStore, path)
    await db.exec(`delete from graph_terms`)
    await db.exec(`delete from doc_terms`)
    try {
      const after = await served(pgWarmStore, path)
      assert.equal(after.res.headers.get('x-warm-store'), 'hit')
      assert.equal(after.res.text, before.res.text)
    } finally {
      setWarmStore(null)
      await restore()
    }
  })
})

describe('the fallback', () => {
  before(built)
  after(restore)

  const path = () => lulaPath('graph', 7)

  it('with setWarmStore(null) reads no row and sets no header', async () => {
    await materialized()
    const statements = await recordStatements(async () => {
      const res = await live(path())
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('x-warm-store'), null)
    })
    assert.ok(statements.every((s) => !/warm_entries/.test(s)))
  })

  it('reads a recorte with no row as a miss and answers the live body, on all three routes (AC8)', async () => {
    await built()
    for (const route of ROUTES) {
      const expected = await live(lulaPath(route, 7))
      const { res } = await served(pgWarmStore, lulaPath(route, 7))
      assert.equal(res.status, 200, route)
      assert.equal(res.headers.get('x-warm-store'), 'miss', route)
      assert.equal(res.text, expected.text, route)
    }
  })

  it('reads an entry built before a second aggregate build as stale and answers the live body, on all three routes (AC8)', async () => {
    await materialized()
    await buildGraphAggregates(persons)
    try {
      for (const route of ROUTES) {
        const expected = await live(lulaPath(route, 7))
        const { res } = await served(pgWarmStore, lulaPath(route, 7))
        assert.equal(res.status, 200, route)
        assert.equal(res.headers.get('x-warm-store'), 'stale', route)
        assert.equal(res.text, expected.text, route)
      }
    } finally {
      await restore()
    }
  })

  it('reads a throwing reader, a keyless reader and a stored row without a key line as a miss with status 200 (AC8)', async () => {
    await built()
    const expected = (await live(path())).text
    const missWith = async (label: string, store: WarmReader) => {
      const { res } = await served(store, path())
      assert.equal(res.status, 200, label)
      assert.equal(res.headers.get('x-warm-store'), 'miss', label)
      assert.equal(res.text, expected, label)
    }
    await missWith('a throwing reader', { get: async () => { throw new Error('store down') } })
    await missWith('a keyless reader', { get: async () => '{"person":{}}' })
    for (const body of ['{"person":{}}', '\n{"person":{}}', '']) {
      await db.exec(`delete from warm_entries`)
      await pgWarmStore.put({ pathname: pathnameOf(path()), personId: 'lula' }, body)
      await missWith(`a stored ${JSON.stringify(body)}`, pgWarmStore)
    }
  })

  it('reads a missing warm_entries table as a miss, 503 with the store-only header, and hits again after migrate, on all three routes (AC9)', async () => {
    await materialized()
    const expected = new Map<string, string>()
    for (const route of ROUTES) expected.set(route, (await live(lulaPath(route, 21))).text)
    await db.exec(`drop table warm_entries`)
    try {
      for (const route of ROUTES) {
        const plain = await served(pgWarmStore, lulaPath(route, 21))
        assert.equal(plain.res.status, 200, route)
        assert.equal(plain.res.headers.get('x-warm-store'), 'miss', route)
        assert.equal(plain.res.text, expected.get(route), route)
        const only = await served(pgWarmStore, lulaPath(route, 21), { 'x-warm-store-only': '1' })
        assert.equal(only.res.status, 503, route)
        assert.deepEqual(JSON.parse(only.res.text), { error: 'warm store miss' })
        assert.equal(only.res.headers.get('cache-control'), 'no-store')
      }
    } finally {
      await migrateP()
    }
    for (const route of ROUTES) {
      const empty = await served(pgWarmStore, lulaPath(route, 21))
      assert.equal(empty.res.headers.get('x-warm-store'), 'miss', `${route}: the new table is empty until materialize runs`)
    }
    await materialize(await dbPersons(), { store: pgWarmStore })
    for (const route of ROUTES) {
      const again = await served(pgWarmStore, lulaPath(route, 21))
      assert.equal(again.res.status, 200, route)
      assert.equal(again.res.headers.get('x-warm-store'), 'hit', route)
      assert.equal(again.res.text, expected.get(route), route)
    }
  })

  it('reads a person-window with no graph_scopes row as a miss without asking the store, and 503 when the store alone was asked', async () => {
    await built()
    await db.exec(`delete from graph_scopes where person_id = 'tarcisio' and days = 7`)
    try {
      const calls: string[] = []
      setWarmStore({ get: async (pathname) => (calls.push(pathname), null) })
      const p = pathOf('tarcisio', 'graph', 7)
      const res = await request(p)
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('x-warm-store'), 'miss')
      assert.equal(calls.length, 0)
      const only = await request(p, { 'x-warm-store-only': '1' })
      assert.equal(only.status, 503)
      assert.equal(calls.length, 0)
    } finally {
      await restore()
    }
  })
})

describe('a recorte that is not warm', () => {
  before(built)
  after(restore)

  const lula = [{ id: 'lula' }]
  const warmOf = (route: string) => warmPathsOf(lula).find((p) => routeOf(p) === route && p.includes('days=7&'))!
  const variant = (path: string, change: Record<string, string>) => {
    const [base, qs] = path.split('?')
    const q = new URLSearchParams(qs)
    for (const [k, v] of Object.entries(change)) q.set(k, v)
    return `${base}?${q}`
  }
  const counted = () => {
    const calls: string[] = []
    setWarmStore({ get: async (pathname) => (calls.push(pathname), null) })
    return calls
  }

  const notWarm: [string, Record<string, string>[]][] = [
    ['graph', [{ min: '3' }, { source: 'rss' }, { domain: 'x' }, { kind: 'word' }]],
    ['sources', [{ source: 'rss' }, { domain: 'x' }]],
    ['testimony', [{ source: 'rss' }, { min: '1' }]],
  ]

  for (const [route, changes] of notWarm)
    for (const change of changes)
      it(`${route} with ${JSON.stringify(change)} runs no warm_entries statement and carries no header (AC11)`, async () => {
        setWarmStore(pgWarmStore)
        let res!: Awaited<ReturnType<typeof request>>
        const statements = await recordStatements(async () => void (res = await request(variant(warmOf(route), change))))
        assert.equal(res.status, 200)
        assert.equal(res.headers.get('x-warm-store'), null)
        assert.ok(statements.length > 0)
        assert.ok(statements.every((s) => !/warm_entries/.test(s)))
      })

  it('testimony keeps looking up with kind=word (the parser drops it) and with min=3 (the warm recorte itself)', async () => {
    const warm = warmRecortes(lula).find((r) => r.route === 'testimony' && r.days === 7)!
    for (const change of [{ kind: 'word' }, { min: '3' }] as Record<string, string>[]) {
      const calls = counted()
      const res = await request(variant(warmOf('testimony'), change))
      assert.equal(res.headers.get('x-warm-store'), 'miss')
      assert.deepEqual(calls, [warm.pathname])
    }
  })

  it('a retired days=30 reads as the warm 21-day recorte and looks up its key (issue #313)', async () => {
    const warm21 = warmRecortes(lula).find((r) => r.route === 'graph' && r.days === 21)!
    for (const days of ['21', '30', '60', '365']) {
      const calls = counted()
      await request(variant(warmOf('graph'), { days }))
      assert.deepEqual(calls, [warm21.pathname], `days=${days}`)
    }
  })

  it('graph looks up only the full atlas set', async () => {
    const calls = counted()
    await request(`/api/people/lula/graph?${params({ days: '7', sort: 'pmi', limit: '18', source: 'all' })}`)
    assert.equal(calls.length, 1)
  })
})

describe('x-warm-store-only', () => {
  before(built)
  after(restore)

  const only = { 'x-warm-store-only': '1' }

  it('answers a hit as usual, with the live body, on all three routes (AC10)', async () => {
    await materialized()
    for (const route of ROUTES) {
      const expected = await live(lulaPath(route, 7))
      const { res } = await served(pgWarmStore, lulaPath(route, 7), only)
      assert.equal(res.status, 200, route)
      assert.equal(res.headers.get('x-warm-store'), 'hit', route)
      assert.equal(res.text, expected.text, route)
    }
  })

  it('turns a miss or stale entry into a 503 that runs only the person, graph_scopes and warm_entries statements, on all three routes (AC10)', async () => {
    const lookups = async (label: string) => {
      for (const route of ROUTES) {
        const { res, statements } = await served(pgWarmStore, lulaPath(route, 7), only)
        assert.equal(res.status, 503, `${label} ${route}`)
        assert.deepEqual(JSON.parse(res.text), { error: 'warm store miss' })
        assert.equal(res.headers.get('cache-control'), 'no-store')
        assert.equal(statements.length, 3, `${label} ${route}: the person, the scope and the entry lookups, no live statement: ${statements.map((s) => s.slice(0, 40)).join(' | ')}`)
        assert.match(statements[0], PERSON)
        assert.match(statements[1], SCOPE)
        assert.match(statements[2], ENTRY)
        assert.equal(touches(statements, /graph_terms|doc_terms|doc_testimony|term_links|term_communities/), 0)
      }
    }
    try {
      await built()
      await lookups('miss')
      await materialized()
      await buildGraphAggregates(persons)
      await lookups('stale')
    } finally {
      await restore()
    }
  })

  it('with no graph_scopes row for the window runs two statements and never reads warm_entries, on all three routes (AC10)', async () => {
    await materialized()
    await db.exec(`delete from graph_scopes where person_id = 'lula' and days = 21`)
    try {
      for (const route of ROUTES) {
        const { res, statements } = await served(pgWarmStore, lulaPath(route, 21), only)
        assert.equal(res.status, 503, route)
        assert.equal(statements.length, 2, `${route}: ${statements.map((s) => s.slice(0, 40)).join(' | ')}`)
        assert.equal(touches(statements, /warm_entries/), 0)
      }
    } finally {
      await restore()
    }
  })

  it('is ignored on /api/people, on a non-warm recorte and with no store configured (AC10)', async () => {
    const path = lulaPath('graph', 7)
    const expected = (await live(path)).text
    const calls: string[] = []
    setWarmStore({ get: async (pathname) => (calls.push(pathname), null) })
    const people = await request('/api/people', only)
    assert.equal(people.status, 200)
    assert.equal(people.headers.get('x-warm-store'), null)
    const coldQuery = new URLSearchParams(path.split('?')[1])
    coldQuery.set('source', 'rss')
    const cold = await request(`${path.split('?')[0]}?${coldQuery}`, only)
    assert.equal(cold.status, 200)
    assert.equal(cold.headers.get('x-warm-store'), null)
    assert.equal(calls.length, 0)
    const off = await served(null, path, only)
    assert.equal(off.res.status, 200)
    assert.equal(off.res.headers.get('x-warm-store'), null)
    assert.equal(off.res.text, expected)
  })
})

// Issue #313 acceptance criteria, quoted by number.
describe('warmRecortes over the 7 and 21 day windows (issue #313 acceptance)', () => {
  const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }))

  it('N people yield one recorte per warmPaths path but /api/people, i.e. N x 2 x 3, every days 7 or 21 (AC22)', () => {
    for (const n of [1, 3, 27]) {
      const recortes = warmRecortes(people(n))
      assert.equal(recortes.length, warmPaths(people(n)).length - 1, `${n} people`)
      assert.equal(recortes.length, n * 2 * 3)
      assert.ok(recortes.every((r) => r.days === 7 || r.days === 21), `${n} people`)
      assert.ok(recortes.every((r) => !/days=(30|60)\b/.test(r.path)), `${n} people`)
    }
  })

  it('the 21-day recortes carry their own keys and pathnames, none shared with the 7-day ones (AC22)', () => {
    const recortes = warmRecortes(people(2))
    const keyOf = (days: number) => new Set(recortes.filter((r) => r.days === days).map((r) => r.pathname))
    assert.equal(keyOf(7).size, 6)
    assert.equal(keyOf(21).size, 6)
    assert.deepEqual([...keyOf(7)].filter((p) => keyOf(21).has(p)), [])
  })
})

