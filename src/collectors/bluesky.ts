import { Console, Data, Effect, Option, Result, Schema, Stream } from 'effect'
import { HttpBody, HttpClient, HttpClientResponse, type HttpClientResponse as Response } from 'effect/unstable/http'
import type { Person, RawDoc } from '../types.js'
import { headers, REQUEST_TIMEOUT_MS } from '../http.js'

const publicHost = 'https://api.bsky.app'
const authHost = 'https://bsky.social'
const maxPages = 5
const pauseMs = 1500

const Post = Schema.Struct({
  uri: Schema.String,
  indexedAt: Schema.optional(Schema.String),
  record: Schema.optional(Schema.Struct({ text: Schema.optional(Schema.String), createdAt: Schema.optional(Schema.String) })),
  author: Schema.optional(Schema.Struct({ handle: Schema.optional(Schema.String) })),
})
type Post = typeof Post.Type

// Decoded loosely, then each post decoded on its own: one malformed post must not cost the
// page's other posts.
const RawPage = Schema.Struct({ posts: Schema.Array(Schema.Unknown), cursor: Schema.optional(Schema.String) })
const SessionBody = Schema.Struct({ accessJwt: Schema.String })
const decodePost = Schema.decodeUnknownResult(Post)

type Session = { host: string; headers: Record<string, string>; pages: number; mode: string }

export class BlueskyError extends Data.TaggedError('BlueskyError')<{ status: number; message: string }> {}

const publicSession: Session = { host: publicHost, headers, pages: 1, mode: 'public (no BSKY_HANDLE/BSKY_APP_PASSWORD)' }

// Bluesky explains a refusal in the body; keep the head of it in the error, on one line.
const refused = (label: string, res: Response.HttpClientResponse) =>
  res.text.pipe(Effect.flatMap((text) => new BlueskyError({ status: res.status, message: `${label} ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 200)}` })))

const ok = (res: Response.HttpClientResponse) => res.status >= 200 && res.status < 300

const login = Effect.gen(function* () {
  const identifier = process.env.BSKY_HANDLE
  const password = process.env.BSKY_APP_PASSWORD
  if (!identifier || !password) return publicSession
  const client = yield* HttpClient.HttpClient
  // The whole read -- headers and body -- sits inside one timeout: FetchHttpClient resolves the
  // request once headers arrive, so a body that stalls after that would otherwise hang forever.
  const { accessJwt } = yield* Effect.gen(function* () {
    const res = yield* client.post(`${authHost}/xrpc/com.atproto.server.createSession`, { headers, body: HttpBody.jsonUnsafe({ identifier, password }) })
    if (!ok(res)) return yield* refused('bluesky login', res)
    return yield* HttpClientResponse.schemaBodyJson(SessionBody)(res)
  }).pipe(Effect.timeout(REQUEST_TIMEOUT_MS))
  return { host: authHost, headers: { ...headers, authorization: `Bearer ${accessJwt}` }, pages: maxPages, mode: `authenticated as ${identifier}` } satisfies Session
})

const fetchPage = (s: Session, q: string, cursor: string | undefined) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* Effect.gen(function* () {
      const res = yield* client.get(`${s.host}/xrpc/app.bsky.feed.searchPosts`, { headers: s.headers, urlParams: { q, lang: 'pt', limit: '100', ...(cursor ? { cursor } : {}) } })
      if (!ok(res)) return yield* refused('bluesky', res)
      const raw = yield* HttpClientResponse.schemaBodyJson(RawPage)(res)
      const posts: Post[] = []
      for (const item of raw.posts) {
        const decoded = decodePost(item)
        if (Result.isSuccess(decoded)) posts.push(decoded.success)
      }
      if (posts.length < raw.posts.length) yield* Console.log(`[bluesky] dropped ${raw.posts.length - posts.length} malformed post(s)`)
      return { posts, cursor: raw.cursor }
    }).pipe(Effect.timeout(REQUEST_TIMEOUT_MS))
  })

const toDoc = (p: Post): RawDoc => ({
  source: 'bluesky',
  uri: p.uri,
  text: p.record?.text ?? '',
  publishedAt: p.record?.createdAt ?? p.indexedAt ?? '',
  domain: p.author?.handle,
})

type Cursor = { cursor: string | undefined; left: number }

// One person's pages, oldest request first: the pause sits before every page but the first,
// so the last page never waits for nothing.
const collectPerson = (s: Session, person: Person) =>
  Stream.paginate({ cursor: undefined, left: s.pages } satisfies Cursor, ({ cursor, left }: Cursor) =>
    Effect.gen(function* () {
      if (cursor) yield* Effect.sleep(pauseMs)
      const page = yield* fetchPage(s, person.name, cursor)
      const next = page.cursor && left > 1 ? Option.some({ cursor: page.cursor, left: left - 1 }) : Option.none()
      return [page.posts.map(toDoc), next] as const
    }),
  ).pipe(Stream.runCollect)

// A person's failure costs that person's posts and a longer pause, never the run.
const collectSafely = (s: Session, person: Person) =>
  collectPerson(s, person).pipe(
    Effect.tap(() => Effect.sleep(pauseMs)),
    Effect.catch((e) => Console.log(`[bluesky] ${person.name}: ${e.message}`).pipe(Effect.andThen(Effect.sleep(pauseMs * 4)), Effect.as([] as RawDoc[]))),
  )

export const collect = (persons: Person[]) =>
  Effect.gen(function* () {
    const session = yield* login
    yield* Console.log(`[bluesky] ${session.mode}, up to ${session.pages} page(s) per person`)
    const docs = yield* Effect.forEach(persons, (p) => collectSafely(session, p))
    return docs.flat()
  })

