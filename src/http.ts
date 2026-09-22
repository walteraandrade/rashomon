import { Data, Effect, Layer, Stream } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/unstable/http'

export const headers = { 'user-agent': 'assoc-graph/0.1 (personal research)' }

// Shared wire-size ceiling for every unbounded network read in the collector layer: getBytes
// here (gdelt, camara, senado through slowGet), gkg.ts's zip fetch and rss.ts's feed fetch. A
// literal, not env-overridable -- see docs/sources.md for the measured GKG slot size this was
// picked against (~13-14MB compressed, ~2.3x headroom).
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

// One ceiling for every request the collector layer makes: a silent connection costs one page,
// never the whole run. Counted from the first byte sent to the last byte read, not per socket idle.
export const REQUEST_TIMEOUT_MS = 45_000

/** Pure accept/reject boundary: does this running total already exceed the limit. */
export const overLimit = (totalBytes: number, limitBytes: number): boolean => totalBytes > limitBytes

/** A declared content-length, from either node:https' headers object or fetch's Headers. */
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

export type CappedRead = { ok: true; data: Uint8Array } | { ok: false; bytes: number }

/** Reads a fetch body stream, capped at limitBytes: never resolves a partial body over the cap. */
export const readCapped = async (body: ReadableStream<Uint8Array> | null, limitBytes: number): Promise<CappedRead> => {
  if (!body) return { ok: true, data: new Uint8Array(0) }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (overLimit(total, limitBytes)) {
      reader.cancel().catch(() => {})
      return { ok: false, bytes: total }
    }
    chunks.push(value)
  }
  return { ok: true, data: concat(chunks, total) }
}

export class ResponseTooLarge extends Data.TaggedError('ResponseTooLarge')<{
  url: string
  stage: 'declared' | 'streaming'
  bytes: number
  limit: number
}> {
  get message() {
    return this.stage === 'declared'
      ? `response too large: declared ${this.bytes} bytes exceeds ${this.limit}`
      : `response too large: exceeded ${this.limit} bytes while streaming`
  }
}

export type Fetched = { status: number; body: Uint8Array }

type Fold = { total: number; chunks: Uint8Array[] }

// One GET, capped the way readCapped caps a web stream: a declared content-length over the limit
// fails before the body is read, a body that grows past it fails mid-stream, which interrupts the
// fetch. Never yields a partial body. Any status resolves; callers read `status` themselves.
export const getBytes = (url: string | URL, limit = MAX_RESPONSE_BYTES) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const res = yield* client.get(url, { headers })
    const declared = headerLength(res.headers['content-length'])
    if (declared !== null && overLimit(declared, limit)) return yield* new ResponseTooLarge({ url: String(url), stage: 'declared', bytes: declared, limit })
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
    )
    return { status: res.status, body: concat(chunks, total) } satisfies Fetched
  })

// The one HttpClient the collectors run on: global fetch, and no trace headers -- Effect's client
// would otherwise stamp `traceparent`/`b3` on every request to GDELT, Bluesky and the chambers,
// which the node:https and fetch calls it replaces never sent.
export const fetchClient: Layer.Layer<HttpClient.HttpClient> = Layer.merge(FetchHttpClient.layer, Layer.succeed(HttpClient.TracerPropagationEnabled, false))

// The boundary between the Effect side and the Promise collectors: fetchClient in, a plain
// Promise out. A failure rejects with the typed error itself, so `.message` reads.
export const runWithFetch = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, fetchClient))

export const sleep = (ms: number): Promise<void> => Effect.runPromise(Effect.sleep(ms))

export const sequential = <A, B>(items: A[], fn: (a: A) => Promise<B>): Promise<B[]> =>
  Effect.runPromise(Effect.forEach(items, (a) => Effect.promise(() => fn(a))))

export type SlowResponse = { status: number; body: string }

export const slowGet = (url: URL, timeoutMs = REQUEST_TIMEOUT_MS): Promise<SlowResponse> =>
  runWithFetch(
    getBytes(url).pipe(
      Effect.timeout(timeoutMs),
      Effect.map(({ status, body }) => ({ status, body: new TextDecoder().decode(body) })),
    ),
  )
