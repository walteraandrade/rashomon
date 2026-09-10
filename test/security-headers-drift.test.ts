import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { HTML_PATHS, SECURITY_HEADERS, vercelHeaders } from '../src/headers.js'
import { app } from '../src/server.js'
import { docsText } from './docs.js'
import { seed } from './fixture.js'
import './close.js'

// Issue #129: the headers live twice, once in vercel.json for the CDN and once in
// src/headers.ts for this process. One test holds the copies together and reads a real
// response, not the JSON shape, for what Hono sends.

const vercelConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'))

describe('security headers drift', () => {
  before(seed)

  it('vercel.json headers equal src/headers.ts byte for byte', () => {
    assert.deepEqual(vercelConfig.headers, vercelHeaders())
  })

  for (const path of HTML_PATHS)
    it(`Hono sends every header on ${path}`, async () => {
      const res = await app.request(path)
      assert.equal(res.status, 200)
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(key), value, key)
    })

  for (const path of ['/api/people', '/api/nope', '/atlas.css', '/bundle.js'])
    it(`Hono sends none of them on ${path}`, async () => {
      const res = await app.request(path)
      for (const key of Object.keys(SECURITY_HEADERS)) assert.equal(res.headers.get(key), null, `${path} carries ${key}`)
    })

  it('the docs say both copies exist and which test binds them', () => {
    assert.match(docsText, /src\/headers\.ts/)
    assert.match(docsText, /security-headers-drift\.test\.ts/)
  })
})
