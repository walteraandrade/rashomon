import { request } from 'node:https'

export const headers = { 'user-agent': 'assoc-graph/0.1 (personal research)' }
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const sequential = async <A, B>(items: A[], fn: (a: A) => Promise<B>): Promise<B[]> =>
  items.reduce<Promise<B[]>>(async (acc, item) => [...(await acc), await fn(item)], Promise.resolve([]))

export type SlowResponse = { status: number; body: string }

// Shared wire-size ceiling for every unbounded network read in the collector layer: slowGet
// here (gdelt, camara, senado), gkg.ts's zip fetch and rss.ts's feed fetch. A literal, not
// env-overridable -- see docs/sources.md for the measured GKG slot size this was picked
// against (~13-14MB compressed, ~2.3x headroom, not the order of magnitude once assumed).
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

/** Pure accept/reject boundary: does this running total already exceed the limit. */
export const overLimit = (totalBytes: number, limitBytes: number): boolean => totalBytes > limitBytes

/** A declared content-length, from either node:https' headers object or fetch's Headers. */
export const headerLength = (value: string | string[] | null | undefined): number | null => {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === undefined || raw === null || raw.trim() === '') return null // Number('') is 0, which would read as a declared zero
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
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
  const data = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    data.set(c, offset)
    offset += c.length
  }
  return { ok: true, data }
}

export const slowGet = (url: URL, timeoutMs = 45_000): Promise<SlowResponse> =>
  new Promise((resolve, reject) => {
    let settled = false
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      reject(err)
    }
    const req = request(url, { headers, timeout: timeoutMs }, (res) => {
      const declared = headerLength(res.headers['content-length'])
      if (declared !== null && overLimit(declared, MAX_RESPONSE_BYTES)) {
        res.destroy()
        fail(new Error(`response too large: declared ${declared} bytes exceeds ${MAX_RESPONSE_BYTES}`))
        return
      }
      const chunks: Buffer[] = []
      let total = 0
      res.on('data', (c: Buffer) => {
        if (settled) return
        total += c.length
        if (overLimit(total, MAX_RESPONSE_BYTES)) {
          res.destroy()
          fail(new Error(`response too large: exceeded ${MAX_RESPONSE_BYTES} bytes while streaming`))
          return
        }
        chunks.push(c)
      })
      res.on('error', fail) // a mid-body abort (ours via destroy(), or the socket's own) must reject, not hang
      res.on('end', () => {
        if (settled) return
        settled = true
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)))
    req.on('error', fail)
    req.end()
  })
