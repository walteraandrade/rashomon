import type { Collector, Person, RawDoc } from '../types.js'
import { headers, sequential, sleep } from '../http.js'

const publicHost = 'https://api.bsky.app'
const authHost = 'https://bsky.social'
const maxPages = 5
const pauseMs = 1500
// Same ceiling as slowGet in http.ts: a silent connection costs one page, not the whole run.
const requestTimeoutMs = 45_000

type Page = { posts: any[]; cursor?: string }
type Session = { host: string; headers: Record<string, string>; pages: number; mode: string }

const login = async (): Promise<Session> => {
  const identifier = process.env.BSKY_HANDLE
  const password = process.env.BSKY_APP_PASSWORD
  if (!identifier || !password) return { host: publicHost, headers, pages: 1, mode: 'public (no BSKY_HANDLE/BSKY_APP_PASSWORD)' }
  const res = await fetch(`${authHost}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  if (!res.ok) throw new Error(`bluesky login ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const { accessJwt } = (await res.json()) as { accessJwt: string }
  return { host: authHost, headers: { ...headers, authorization: `Bearer ${accessJwt}` }, pages: maxPages, mode: `authenticated as ${identifier}` }
}

const fetchPage = async (s: Session, q: string, cursor?: string): Promise<Page> => {
  const url = new URL(`${s.host}/xrpc/app.bsky.feed.searchPosts`)
  url.searchParams.set('q', q)
  url.searchParams.set('lang', 'pt')
  url.searchParams.set('limit', '100')
  if (cursor) url.searchParams.set('cursor', cursor)
  const res = await fetch(url, { headers: s.headers, signal: AbortSignal.timeout(requestTimeoutMs) })
  if (!res.ok) throw new Error(`bluesky ${res.status}: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 160)}`)
  return res.json() as Promise<Page>
}

const toDoc = (p: any): RawDoc => ({
  source: 'bluesky',
  uri: p.uri,
  text: p.record?.text ?? '',
  publishedAt: p.record?.createdAt ?? p.indexedAt,
  domain: p.author?.handle,
})

const collectPerson = async (s: Session, person: Person, cursor?: string, left = s.pages): Promise<RawDoc[]> => {
  if (left === 0) return []
  const page = await fetchPage(s, person.name, cursor)
  const docs = page.posts.map(toDoc)
  if (!page.cursor || left === 1) return docs
  await sleep(pauseMs)
  return [...docs, ...(await collectPerson(s, person, page.cursor, left - 1))]
}

const collectSafely = async (s: Session, person: Person): Promise<RawDoc[]> => {
  try {
    const docs = await collectPerson(s, person)
    await sleep(pauseMs)
    return docs
  } catch (e) {
    console.log(`[bluesky] ${person.name}: ${(e as Error).message}`)
    await sleep(pauseMs * 4)
    return []
  }
}

export const bluesky: Collector = async (persons) => {
  const session = await login()
  console.log(`[bluesky] ${session.mode}, up to ${session.pages} page(s) per person`)
  return (await sequential(persons, (p) => collectSafely(session, p))).flat()
}
