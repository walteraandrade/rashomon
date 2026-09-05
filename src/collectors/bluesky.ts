import type { Collector, Person, RawDoc } from '../types.js'
import { headers, sequential } from '../http.js'

const publicHost = 'https://api.bsky.app'
const authHost = 'https://bsky.social'
const maxPages = 5

type Page = { posts: any[]; cursor?: string }
type Session = { host: string; headers: Record<string, string>; pages: number }

const login = async (): Promise<Session> => {
  const identifier = process.env.BSKY_HANDLE
  const password = process.env.BSKY_APP_PASSWORD
  if (!identifier || !password) return { host: publicHost, headers, pages: 1 }
  const res = await fetch(`${authHost}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  })
  if (!res.ok) throw new Error(`bluesky login ${res.status}`)
  const { accessJwt } = (await res.json()) as { accessJwt: string }
  return { host: authHost, headers: { ...headers, authorization: `Bearer ${accessJwt}` }, pages: maxPages }
}

const fetchPage = async (s: Session, q: string, cursor?: string): Promise<Page> => {
  const url = new URL(`${s.host}/xrpc/app.bsky.feed.searchPosts`)
  url.searchParams.set('q', q)
  url.searchParams.set('lang', 'pt')
  url.searchParams.set('limit', '100')
  if (cursor) url.searchParams.set('cursor', cursor)
  const res = await fetch(url, { headers: s.headers })
  if (!res.ok) throw new Error(`bluesky ${res.status}`)
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
  return page.cursor ? [...docs, ...(await collectPerson(s, person, page.cursor, left - 1))] : docs
}

export const bluesky: Collector = async (persons) => {
  const session = await login()
  return (await sequential(persons, (p) => collectPerson(session, p))).flat()
}
