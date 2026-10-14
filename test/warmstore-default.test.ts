import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { app } from '../src/server.js'
import { warmRecortes } from '../src/warmstore.js'
import { materialized, restore } from './warmstore-helpers.js'
import './close.js'

// Never calls setWarmStore: another test's call would hide what the server starts with.
describe('the server\'s default store', () => {
  after(restore)

  it('answers a hit from warm_entries with no environment variable set', async () => {
    for (const name of ['BLOB_READ_WRITE_TOKEN', 'WARM_STORE_URL']) delete process.env[name]
    await materialized()
    for (const r of warmRecortes([{ id: 'lula' }])) {
      const res = await app.request(r.path)
      assert.equal(res.status, 200, r.path)
      assert.equal(res.headers.get('x-warm-store'), 'hit', r.path)
    }
  })
})
