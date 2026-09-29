import { put as sdkPut } from '@vercel/blob'
import type { WarmWriter } from './warmstore.js'

export type BlobPutOptions = {
  access: 'public'
  addRandomSuffix: false
  allowOverwrite: true
  cacheControlMaxAge: number
  contentType: string
  token: string
}

export type BlobPut = (pathname: string, body: string, options: BlobPutOptions) => Promise<unknown>

export const realPut: BlobPut = (pathname, body, options) => sdkPut(pathname, body, options)

// allowOverwrite and addRandomSuffix: false keep the key set fixed (an overwrite in place, never a
// suffixed sibling). 60 s is the SDK's floor for cacheControlMaxAge: between `pnpm ingest` bumping
// built_at and the next put, a reader asks for the new `?v=` and gets the old body, and the CDN
// must not keep that copy under the new key for the SDK's default month.
export const blobWriter = (put: BlobPut, token: string): WarmWriter => ({
  put: async (pathname, text) => {
    await put(pathname, text, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: 'text/plain; charset=utf-8',
      token,
    })
  },
})
