import { request } from 'node:https'

export const headers = { 'user-agent': 'assoc-graph/0.1 (personal research)' }
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const sequential = async <A, B>(items: A[], fn: (a: A) => Promise<B>): Promise<B[]> =>
  items.reduce<Promise<B[]>>(async (acc, item) => [...(await acc), await fn(item)], Promise.resolve([]))

export type SlowResponse = { status: number; body: string }

export const slowGet = (url: URL, timeoutMs = 45_000): Promise<SlowResponse> =>
  new Promise((resolve, reject) => {
    const req = request(url, { headers, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)))
    req.on('error', reject)
    req.end()
  })
