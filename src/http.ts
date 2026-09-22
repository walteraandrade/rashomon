import { Data, Effect, Layer, Stream } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientError } from 'effect/unstable/http'

export const headers = { 'user-agent': 'assoc-graph/0.1 (personal research)' }

// Shared wire-size ceiling for every unbounded network read in the collector layer: getBytes
// here (gdelt, camara, senado, rss and gkg's zip fetch all read through it). A literal, not
// env-overridable -- see docs/sources.md for the measured GKG slot size this was picked
// against (~13-14MB compressed, ~2.3x headroom).
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

// One ceiling for every request the collector layer makes: a silent connection costs one page,
// never the whole run. Counted from the first byte sent to the last byte read, not per socket idle.
export const REQUEST_TIMEOUT_MS = 45_000

/** Pure accept/reject boundary: does this running total already exceed the limit. */
export const overLimit = (totalBytes: number, limitBytes: number): boolean => totalBytes > limitBytes

/** A declared content-length: Effect's HttpClientResponse.headers is single-valued, but this also accepts a repeated header's array shape. */
export const headerLength = (value: string | string[] | null | undefined): number | null => {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === undefined || raw === null || raw.trim() === '') return null // Number('') is 0, which would read as a declared zero
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

const concat = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  const data = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    data.set(c, offset)
    offset += c.length
  }
  return data
}

export class ResponseTooLarge extends Data.TaggedError('ResponseTooLarge')<{
  url: string
  stage: 'declared' | 'streaming'
  bytes: number
  limit: number
}> {
  get message() {
    return this.stage === 'declared'
      ? `${this.url}: response too large: declared ${this.bytes} bytes exceeds ${this.limit}`
      : `${this.url}: response too large: exceeded ${this.limit} bytes while streaming`
  }
}

export type Fetched = { status: number; body: Uint8Array }

type Fold = { total: number; chunks: Uint8Array[] }

// One GET, capped and timed: a declared content-length over the limit fails before the body is
// read, a body that grows past it fails mid-stream (which interrupts the fetch), and the whole
// call is cut at timeoutMs -- the byte cap and the wall-clock cap travel together so every caller
// carries both. Never yields a partial body. Any status resolves; callers read `status` themselves.
export const getBytes = (url: string | URL, limit = MAX_RESPONSE_BYTES, timeoutMs = REQUEST_TIMEOUT_MS) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const res = yield* client.get(url, { headers })
    const declared = headerLength(res.headers['content-length'])
    if (declared !== null && overLimit(declared, limit)) return yield* new ResponseTooLarge({ url: String(url), stage: 'declared', bytes: declared, limit })
    // A status the fetch spec forbids a body on (204, 304, ...) or a response built with a null
    // body -- like a bare 404 -- makes `.stream` throw EmptyBodyError rather than yield nothing;
    // treated the same way HttpServerResponse.fromClientResponse does, as zero bytes.
    const { total, chunks } = yield* res.stream.pipe(
      Stream.runFoldEffect(
        (): Fold => ({ total: 0, chunks: [] }),
        (acc, chunk) => {
          const total = acc.total + chunk.length
          return overLimit(total, limit)
            ? new ResponseTooLarge({ url: String(url), stage: 'streaming', bytes: total, limit })
            : Effect.succeed({ total, chunks: [...acc.chunks, chunk] })
        },
      ),
      Effect.catch((e) =>
        HttpClientError.isHttpClientError(e) && e.reason._tag === 'EmptyBodyError' ? Effect.succeed({ total: 0, chunks: [] as Uint8Array[] }) : Effect.fail(e),
      ),
    )
    return { status: res.status, body: concat(chunks, total) } satisfies Fetched
  }).pipe(Effect.timeout(timeoutMs))

// The one HttpClient the collectors run on: global fetch, and no trace headers -- Effect's client
// would otherwise stamp `traceparent`/`b3` on every request to GDELT, Bluesky and the chambers,
// which every collector's earlier direct fetch() call never sent.
export const fetchClient: Layer.Layer<HttpClient.HttpClient> = Layer.merge(FetchHttpClient.layer, Layer.succeed(HttpClient.TracerPropagationEnabled, false))

// The boundary between the Effect side and the Promise collectors: fetchClient in, a plain
// Promise out. A failure rejects with the typed error itself, so `.message` reads.
export const runWithFetch = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, fetchClient))
