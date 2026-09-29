import assert from 'node:assert/strict'
import { after, before, describe, it, mock } from 'node:test'
import { buildGraphAggregates } from '../src/aggregate.js'
import { db } from '../src/db.js'
import { DAYS, parseQuery, parseTestimonyQuery } from '../src/query.js'
import { app, setWarmStore } from '../src/server.js'
import { params } from '../src/ui/api.js'
import { warmPaths, WARM_DAYS } from '../src/warm.js'
import { blobReader, entryText, memoryWarmStore, pathnameOf, splitEntry, storeKey, warmRecortes, type WarmReader } from '../src/warmstore.js'
import { persons, seed } from './fixture.js'
import { built, materialized, recordStatements, restore } from './warmstore-helpers.js'
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
  })

  it('materialising writes exactly those pathnames, bolsonaro\'s empty windows included', async () => {
    const { store } = await materialized()
    assert.deepEqual([...store.entries.keys()].sort(), warmRecortes(ids).map((r) => r.pathname).sort())
    const empty = JSON.parse(splitEntry(store.entries.get(warmRecortes(ids).find((r) => r.personId === 'bolsonaro' && r.route === 'graph' && r.days === 7)!.pathname)!)!.body)
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
    const changed: Record<string, string> = { days: '30', source: 'rss', min: '3', limit: '20', sort: 'count', kind: 'word', domain: 'g1.globo.com', lean: 'left', country: 'pt', method: 'stub', testimony: '', communities: '' }
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

describe('a stored recorte', () => {
  before(built)
  after(restore)

  it('is byte-identical to the live route on every warm path of every fixture person, bolsonaro\'s empty windows included', async () => {
    const { store } = await materialized()
    for (const path of warmPathsOf()) {
      setWarmStore(store)
      const stored = await request(path)
      const expected = await live(path)
      assert.equal(stored.status, 200, path)
      assert.equal(stored.headers.get('x-warm-store'), 'hit', path)
      assert.equal(stored.text, expected.text, path)
      assert.equal(stored.headers.get('content-type'), expected.headers.get('content-type'), path)
      assert.equal(stored.headers.get('cache-control'), expected.headers.get('cache-control'), path)
      assert.equal(expected.headers.get('x-warm-store'), null, path)
    }
  })

  it('carries person-less links in at least one graph body, at most C(n,2) of them', async () => {
    const { store } = await materialized()
    let personLess = 0
    for (const r of warmRecortes(ids).filter((r) => r.route === 'graph')) {
      const body = JSON.parse(splitEntry(store.entries.get(r.pathname)!)!.body)
      const extra = body.links.filter((l: { source: string }) => l.source !== `person:${r.personId}`)
      const n = body.nodes.length
      assert.ok(extra.length <= (n * (n - 1)) / 2, `${r.path}: ${extra.length} links among ${n} nodes`)
      personLess += extra.length
    }
    assert.ok(personLess > 0, 'the byte-identity check is not vacuous: some body has a word-to-word link')
  })

  it('answers a hit without the corpus, in two statements', async () => {
    const { store } = await materialized()
    setWarmStore(store)
    const path = warmPathsOf()[0]
    const before = await request(path)
    await db.exec(`delete from graph_terms`)
    await db.exec(`delete from doc_terms`)
    try {
      let after!: Awaited<ReturnType<typeof request>>
      const statements = await recordStatements(async () => void (after = await request(path)))
      assert.equal(after.headers.get('x-warm-store'), 'hit')
      assert.equal(after.text, before.text)
      assert.equal(statements.length, 2)
      assert.match(statements[0], /from persons where id = \$1/)
      assert.match(statements[1], /from graph_scopes/)
      for (const s of statements) assert.doesNotMatch(s, /doc_terms|graph_terms/)
    } finally {
      setWarmStore(null)
      await restore()
    }
  })
})

describe('the fallback', () => {
  before(built)
  after(restore)

  const path = () => warmPathsOf([{ id: 'lula' }]).find((p) => routeOf(p) === 'graph')!

  it('runs live with no store configured, and with an unset store answers no header', async () => {
    setWarmStore(null)
    const res = await request(path())
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-warm-store'), null)
  })

  it('reads a warm recorte with no entry as a miss and answers the live body', async () => {
    const expected = await live(path())
    setWarmStore(memoryWarmStore())
    const res = await request(path())
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-warm-store'), 'miss')
    assert.equal(res.text, expected.text)
  })

  it('reads an entry built before a second aggregate build as stale and answers the live body', async () => {
    const { store } = await materialized()
    await buildGraphAggregates(persons)
    try {
      const expected = await live(path())
      setWarmStore(store)
      const res = await request(path())
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('x-warm-store'), 'stale')
      assert.equal(res.text, expected.text)
    } finally {
      await restore()
    }
  })

  it('reads a throwing store, a 500, and an entry with no key line as a miss with status 200', async () => {
    const expected = await live(path())
    const throwing: WarmReader = { get: async () => { throw new Error('store down') } }
    const failing = blobReader('https://blob.test', (async () => ({ status: 500, text: async () => 'boom' })) as unknown as typeof fetch)
    const keyless: WarmReader = { get: async () => '{"person":{}}' }
    for (const store of [throwing, failing, keyless]) {
      setWarmStore(store)
      const res = await request(path())
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('x-warm-store'), 'miss')
      assert.equal(res.text, expected.text)
    }
  })

  it('reads a store that never answers as a miss after the reader\'s 2 s timeout', async () => {
    const expected = await live(path())
    let called!: () => void
    const asked = new Promise<void>((resolve) => (called = resolve))
    // The clock is mocked inside the fetch, after the database reads, so the live fallback never runs under it.
    const hanging = (() => {
      mock.timers.enable({ apis: ['setTimeout'] })
      called()
      return new Promise(() => undefined)
    }) as unknown as typeof fetch
    setWarmStore(blobReader('https://blob.test', hanging))
    const pending = request(path())
    await asked
    mock.timers.tick(2000)
    mock.timers.reset()
    const res = await pending
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-warm-store'), 'miss')
    assert.equal(res.text, expected.text)
  })

  it('reads a person-window with no graph_scopes row as a miss without asking the store, and 503 when the store alone was asked', async () => {
    await db.exec(`delete from graph_scopes where person_id = 'tarcisio' and days = 7`)
    try {
      const calls: string[] = []
      setWarmStore({ get: async (pathname) => (calls.push(pathname), null) })
      const p = warmPathsOf([{ id: 'tarcisio' }]).find((x) => routeOf(x) === 'graph' && x.includes('days=7&'))!
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
    ['graph', [{ min: '3' }, { source: 'rss' }, { domain: 'x' }, { days: String(Math.max(...DAYS)) }, { kind: 'word' }]],
    ['sources', [{ source: 'rss' }, { domain: 'x' }]],
    ['testimony', [{ source: 'rss' }, { min: '1' }]],
  ]

  for (const [route, changes] of notWarm)
    for (const change of changes)
      it(`${route} with ${JSON.stringify(change)} never reaches the store and carries no header`, async () => {
        const calls = counted()
        const res = await request(variant(warmOf(route), change))
        assert.equal(res.status, 200)
        assert.equal(calls.length, 0)
        assert.equal(res.headers.get('x-warm-store'), null)
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
  const path = () => warmPathsOf([{ id: 'lula' }]).find((p) => routeOf(p) === 'sources')!

  it('answers a hit as usual', async () => {
    const { store } = await materialized()
    setWarmStore(store)
    const res = await request(path(), only)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-warm-store'), 'hit')
  })

  it('turns a miss or stale entry into a 503 that runs only the two lookup statements', async () => {
    const { store } = await materialized()
    await buildGraphAggregates(persons)
    try {
      for (const s of [memoryWarmStore(), store]) {
        setWarmStore(s)
        let res!: Awaited<ReturnType<typeof request>>
        const statements = await recordStatements(async () => void (res = await request(path(), only)))
        assert.equal(res.status, 503)
        assert.deepEqual(JSON.parse(res.text), { error: 'warm store miss' })
        assert.equal(res.headers.get('cache-control'), 'no-store')
        assert.equal(statements.length, 2, 'the person and the scope lookups, no live statement')
      }
    } finally {
      await restore()
    }
  })

  it('is ignored on /api/people, on a non-warm recorte and with no store configured', async () => {
    const calls: string[] = []
    setWarmStore({ get: async (pathname) => (calls.push(pathname), null) })
    const people = await request('/api/people', only)
    assert.equal(people.status, 200)
    const coldPath = path().replace('source=all', 'source=rss')
    assert.equal((await request(coldPath, only)).status, 200)
    setWarmStore(null)
    assert.equal((await request(path(), only)).status, 200)
    assert.equal(calls.length, 0)
  })
})

describe('the blob reader', () => {
  const stub = (status: number, body = 'text') => {
    const urls: string[] = []
    const fetchFn = (async (url: string) => (urls.push(url), { status, text: async () => body })) as unknown as typeof fetch
    return { urls, fetchFn }
  }

  it('asks for the versioned url and returns the body', async () => {
    const { urls, fetchFn } = stub(200, 'k\n{}')
    const reader = blobReader('https://blob.test/', fetchFn)
    const pathname = pathnameOf('tarcísio', 'graph', 'abc')
    assert.equal(await reader.get(pathname, '2026-09-29 10:00:00.5+00'), 'k\n{}')
    assert.deepEqual(urls, [`https://blob.test/warm/v1/tarc%C3%ADsio/graph/abc.json?v=${encodeURIComponent('2026-09-29 10:00:00.5+00')}`])
  })

  it('returns null on a non-200 answer and on a thrown fetch', async () => {
    assert.equal(await blobReader('https://blob.test', stub(404).fetchFn).get('p', 'k'), null)
    const thrower = (async () => { throw new Error('network') }) as unknown as typeof fetch
    assert.equal(await blobReader('https://blob.test', thrower).get('p', 'k'), null)
  })

  it('returns null once 2 s pass without an answer', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const reader = blobReader('https://blob.test', (() => new Promise(() => undefined)) as unknown as typeof fetch)
      const pending = reader.get('p', 'k')
      mock.timers.tick(1999)
      let settled = false
      void pending.then(() => (settled = true))
      await Promise.resolve()
      assert.equal(settled, false)
      mock.timers.tick(1)
      assert.equal(await pending, null)
    } finally {
      mock.timers.reset()
    }
  })
})
