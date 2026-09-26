import type { Cause, Effect, Schema } from 'effect'
import type { HttpClient, HttpClientError } from 'effect/unstable/http'
import type { SqlClient } from 'effect/unstable/sql'
import type { ResponseTooLarge } from './http.js'
import type { BlueskyError } from './collectors/bluesky.js'
import type { GkgError } from './collectors/gkg.js'
import type { RssError } from './collectors/rss.js'

export type Person = { id: string; name: string; aliases: string[]; exclude?: string[]; camaraId?: string; senadoId?: string; wikipedia?: string }
export type Source = 'bluesky' | 'gdelt' | 'rss' | 'gnews' | 'gkg' | 'camara' | 'senado' | 'juridico' | 'oficial' | 'nicho'
export type RawDoc = {
  source: Source
  uri: string
  text: string
  publishedAt: string
  domain?: string
  tone?: number
  extraTerms?: Term[]
  extraNames?: string[]
}
// An explicit union, not `Effect.Effect.Error<ReturnType<typeof collect>>` inference, so a new
// collector error type is a visible addition here; gkg and rss raise their own tagged class.
export type CollectorError = ResponseTooLarge | BlueskyError | GkgError | RssError | HttpClientError.HttpClientError | Schema.SchemaError | Cause.TimeoutError
export type Collector = (persons: Person[]) => Effect.Effect<RawDoc[], CollectorError, HttpClient.HttpClient | SqlClient.SqlClient>
export type Term = { term: string; kind: 'hashtag' | 'word' | 'phrase' }
// A 'phrase' term is several words read as one unit: a proper noun the writer capitalized
// ('alexandre de moraes'), or a collocation the corpus itself shows sticking together
// ('primeiro turno'). The lexicon of the latter is built by `pnpm reindex` (src/phrases.ts)
// and passed back into extraction, so ingest and reindex tag the same pairs.
export type Phrases = ReadonlySet<string>
// `persons` is every tracked person: the window around the mention (src/scorers/window.ts) needs
// the other aliases that claim a span first, and the person's own `exclude` names.
export type Scorer = (text: string, person: Person, persons: Person[]) => Promise<number | null>
