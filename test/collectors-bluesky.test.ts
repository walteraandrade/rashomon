import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Exit } from 'effect'
import { BlueskyError, collect } from '../src/collectors/bluesky.js'
import type { Person } from '../src/types.js'
import { drain, fakeFetch, failureOf, hanging, hangingBody, json, runTest, type Call } from './effect.js'
import { withEnv } from './env.js'

const ana: Person = { id: 'ana', name: 'Ana Souza', aliases: ['Ana Souza'] }
const bento: Person = { id: 'bento', name: 'Bento Lima', aliases: ['Bento Lima'] }

const post = (n: number, extra: Record<string, unknown> = {}) => ({
  uri: `at://did:plc:x/app.bsky.feed.post/${n}`,
  indexedAt: `2026-09-2${n}T10:00:00Z`,
  record: { text: `post ${n}`, createdAt: `2026-09-2${n}T09:00:00Z` },
  author: { handle: `user${n}.bsky.social` },
  ...extra,
})

const isSearch = (c: Call) => c.url.pathname === '/xrpc/app.bsky.feed.searchPosts'
const isLogin = (c: Call) => c.url.pathname === '/xrpc/com.atproto.server.createSession'

const PAUSE = 1500
const anonymous = { BSKY_HANDLE: undefined, BSKY_APP_PASSWORD: undefined }
const credentials = { BSKY_HANDLE: 'walter.test', BSKY_APP_PASSWORD: 'app-secret' }

describe('bluesky collector, public mode', () => {
  it('asks api.bsky.app for one page per person, no login, and maps posts to docs', async () => {
    const fetchFn = fakeFetch((c) => json({ posts: [post(1)], cursor: 'more' }))
    const exit = await withEnv(anonymous, () => runTest(drain(collect([ana, bento]), PAUSE), fetchFn))
    assert.ok(Exit.isSuccess(exit))
    const { exit: inner, log } = exit.value
    assert.ok(Exit.isSuccess(inner))
    assert.equal(fetchFn.calls.filter(isLogin).length, 0)
    const searches = fetchFn.calls.filter(isSearch)
    assert.equal(searches.length, 2, 'a public session reads one page per person even when a cursor is offered')
    assert.equal(searches[0].url.host, 'api.bsky.app')
    assert.equal(searches[0].url.searchParams.get('q'), 'Ana Souza')
    assert.equal(searches[0].url.searchParams.get('lang'), 'pt')
    assert.equal(searches[0].url.searchParams.get('limit'), '100')
    assert.equal(searches[0].url.searchParams.has('cursor'), false)
    assert.equal(searches[0].headers.get('authorization'), null)
    assert.deepEqual(inner.value[0], {
      source: 'bluesky',
      uri: 'at://did:plc:x/app.bsky.feed.post/1',
      text: 'post 1',
      publishedAt: '2026-09-21T09:00:00Z',
      domain: 'user1.bsky.social',
    })
    assert.equal(log[0], '[bluesky] public (no BSKY_HANDLE/BSKY_APP_PASSWORD), up to 1 page(s) per person')
  })

  it('falls back to indexedAt when the record has no createdAt, and to empty text', async () => {
    const fetchFn = fakeFetch(() => json({ posts: [post(2, { record: {} })] }))
    const exit = await withEnv(anonymous, () => runTest(drain(collect([ana]), PAUSE), fetchFn))
    assert.ok(Exit.isSuccess(exit) && Exit.isSuccess(exit.value.exit))
    assert.equal(exit.value.exit.value[0].publishedAt, '2026-09-22T10:00:00Z')
    assert.equal(exit.value.exit.value[0].text, '')
  })
})

describe('bluesky collector, authenticated', () => {
  const session = (c: Call) => (isLogin(c) ? json({ accessJwt: 'jwt-123' }) : null)

  it('logs in once, then follows the cursor on bsky.social with the bearer token, up to five pages', async () => {
    const fetchFn = fakeFetch((c) => {
      const login = session(c)
      if (login) return login
      const cursor = c.url.searchParams.get('cursor')
      const n = cursor ? Number(cursor) : 1
      return json({ posts: [post(n)], cursor: String(n + 1) })
    })
    const exit = await withEnv(credentials, () => runTest(drain(collect([ana]), PAUSE), fetchFn))
    assert.ok(Exit.isSuccess(exit) && Exit.isSuccess(exit.value.exit))
    const logins = fetchFn.calls.filter(isLogin)
    assert.equal(logins.length, 1)
    assert.equal(logins[0].method, 'POST')
    assert.equal(logins[0].url.host, 'bsky.social')
    assert.deepEqual(JSON.parse(logins[0].body ?? ''), { identifier: 'walter.test', password: 'app-secret' })
    const searches = fetchFn.calls.filter(isSearch)
    assert.equal(searches.length, 5)
    assert.ok(searches.every((c) => c.url.host === 'bsky.social' && c.headers.get('authorization') === 'Bearer jwt-123'))
    assert.deepEqual(searches.map((c) => c.url.searchParams.get('cursor')), [null, '2', '3', '4', '5'])
    assert.equal(exit.value.exit.value.length, 5)
    assert.equal(exit.value.log[0], '[bluesky] authenticated as walter.test, up to 5 page(s) per person')
  })

  it('stops early when a page carries no cursor, and paces: one pause between pages, one after each person', async () => {
    const fetchFn = fakeFetch((c) => {
      const login = session(c)
      if (login) return login
      const q = c.url.searchParams.get('q')
      const cursor = c.url.searchParams.get('cursor')
      if (q === 'Ana Souza') return cursor ? json({ posts: [post(2)] }) : json({ posts: [post(1)], cursor: 'p2' })
      return json({ posts: [post(3)] })
    })
    const exit = await withEnv(credentials, () => runTest(drain(collect([ana, bento]), PAUSE), fetchFn))
    assert.ok(Exit.isSuccess(exit) && Exit.isSuccess(exit.value.exit))
    assert.equal(fetchFn.calls.filter(isSearch).length, 3)
    assert.equal(exit.value.exit.value.length, 3)
    // Ana: 2 pages (one pause between) + pause after; Bento: 1 page + pause after.
    assert.equal(exit.value.elapsedMs, PAUSE * 3)
  })

  it('a refused login fails the whole run with the status and the head of the body', async () => {
    const fetchFn = fakeFetch(() => new Response('{"error":"AuthenticationRequired","message":"Invalid identifier or password"}', { status: 401 }))
    const exit = await withEnv(credentials, () => runTest(drain(collect([ana]), PAUSE), fetchFn))
    assert.ok(Exit.isSuccess(exit))
    const error = failureOf(exit.value.exit)
    assert.ok(error instanceof BlueskyError)
    assert.equal(error.status, 401)
    assert.equal(error.message, 'bluesky login 401: {"error":"AuthenticationRequired","message":"Invalid identifier or password"}')
    assert.equal(fetchFn.calls.filter(isSearch).length, 0)
  })
})

describe('bluesky collector, one person failing', () => {
  it('a refused search costs that person, a log line and a longer pause, never the run', async () => {
    const fetchFn = fakeFetch((c) => (c.url.searchParams.get('q') === 'Ana Souza' ? new Response('RateLimitExceeded\n  slow down', { status: 429 }) : json({ posts: [post(3)] })))
    const exit = await withEnv(anonymous, () => runTest(drain(collect([ana, bento]), PAUSE), fetchFn))
    assert.ok(Exit.isSuccess(exit) && Exit.isSuccess(exit.value.exit))
    assert.deepEqual(
      exit.value.exit.value.map((d) => d.uri),
      ['at://did:plc:x/app.bsky.feed.post/3'],
    )
    assert.equal(exit.value.log[1], '[bluesky] Ana Souza: bluesky 429: RateLimitExceeded slow down')
    // Ana: failure pause of 4x; Bento: one page + pause after.
    assert.equal(exit.value.elapsedMs, PAUSE * 4 + PAUSE)
  })

  it('a silent connection is cut after 45 s, aborted, and treated like any other failure', async () => {
    const fetchFn = fakeFetch((c) => (c.url.searchParams.get('q') === 'Ana Souza' ? hanging(c) : json({ posts: [post(3)] })))
    const exit = await withEnv(anonymous, () => runTest(drain(collect([ana, bento]), 45_000), fetchFn))
    assert.ok(Exit.isSuccess(exit) && Exit.isSuccess(exit.value.exit))
    assert.equal(exit.value.exit.value.length, 1)
    assert.equal(fetchFn.calls.find((c) => c.url.searchParams.get('q') === 'Ana Souza')?.signal.aborted, true)
    assert.match(exit.value.log[1], /^\[bluesky\] Ana Souza: .*45/i)
  })

  it('a page that is not the shape Bluesky documents is that person\'s failure too', async () => {
    const fetchFn = fakeFetch((c) => (c.url.searchParams.get('q') === 'Ana Souza' ? json({ items: [] }) : json({ posts: [post(3)] })))
    const exit = await withEnv(anonymous, () => runTest(drain(collect([ana, bento]), PAUSE), fetchFn))
    assert.ok(Exit.isSuccess(exit) && Exit.isSuccess(exit.value.exit))
    assert.equal(exit.value.exit.value.length, 1)
    assert.match(exit.value.log[1], /^\[bluesky\] Ana Souza: /)
  })

  it('a body that stalls after headers is cut after 45 s too, not just a headers-stage hang', async () => {
    const fetchFn = fakeFetch((c) => (c.url.searchParams.get('q') === 'Ana Souza' ? hangingBody(c) : json({ posts: [post(3)] })))
    const exit = await withEnv(anonymous, () => runTest(drain(collect([ana, bento]), 45_000), fetchFn))
    assert.ok(Exit.isSuccess(exit) && Exit.isSuccess(exit.value.exit))
    assert.equal(exit.value.exit.value.length, 1)
    assert.equal(fetchFn.calls.find((c) => c.url.searchParams.get('q') === 'Ana Souza')?.signal.aborted, true)
    assert.match(exit.value.log[1], /^\[bluesky\] Ana Souza: .*45/i)
  })

  it('one malformed post in a page costs only that post, not its valid siblings', async () => {
    const fetchFn = fakeFetch((c) =>
      c.url.searchParams.get('q') === 'Ana Souza' ? json({ posts: [post(1), { record: { text: 'no uri here' } }] }) : json({ posts: [post(3)] }),
    )
    const exit = await withEnv(anonymous, () => runTest(drain(collect([ana, bento]), PAUSE), fetchFn))
    assert.ok(Exit.isSuccess(exit) && Exit.isSuccess(exit.value.exit))
    assert.deepEqual(
      exit.value.exit.value.map((d) => d.uri),
      ['at://did:plc:x/app.bsky.feed.post/1', 'at://did:plc:x/app.bsky.feed.post/3'],
    )
    assert.ok(exit.value.log.some((line) => /dropped 1 malformed post/.test(line)))
  })
})
