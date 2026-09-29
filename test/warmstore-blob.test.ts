import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { blobWriter, type BlobPutOptions } from '../src/warmstore-blob.js'

describe('the blob writer', () => {
  it('passes allowOverwrite, addRandomSuffix false, cacheControlMaxAge 60, the content type and the token', async () => {
    const calls: { pathname: string; body: string; options: BlobPutOptions }[] = []
    const writer = blobWriter(async (pathname, body, options) => void calls.push({ pathname, body, options }), 'tok-123')
    await writer.put('warm/v1/lula/graph/abc.json', 'key\n{}')
    await writer.put('warm/v1/lula/sources/def.json', 'key\n[]')
    assert.equal(calls.length, 2)
    assert.deepEqual(
      calls.map((c) => [c.pathname, c.body]),
      [
        ['warm/v1/lula/graph/abc.json', 'key\n{}'],
        ['warm/v1/lula/sources/def.json', 'key\n[]'],
      ],
    )
    for (const { options } of calls) {
      assert.equal(options.access, 'public')
      assert.equal(options.addRandomSuffix, false)
      assert.equal(options.allowOverwrite, true)
      assert.equal(options.cacheControlMaxAge, 60)
      assert.equal(options.contentType, 'text/plain; charset=utf-8')
      assert.equal(options.token, 'tok-123')
      assert.deepEqual(Object.keys(options).sort(), ['access', 'addRandomSuffix', 'allowOverwrite', 'cacheControlMaxAge', 'contentType', 'token'])
    }
  })

  it('lets a rejected put reach the caller', async () => {
    const writer = blobWriter(async () => {
      throw new Error('blob down')
    }, 't')
    await assert.rejects(writer.put('p', 't'), /blob down/)
  })
})
