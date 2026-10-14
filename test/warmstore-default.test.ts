import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { app } from '../src/server.js'
import { splitEntry, warmRecortes } from '../src/warmstore.js'
import { materialized, restore, storedEntries } from './warmstore-helpers.js'
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

describe('the default store, from the spec (issue #317 acceptance)', () => {
  after(restore)

  it('a materialized warm path answers x-warm-store hit in a process that never calls setWarmStore, with no environment variable set (AC12)', async () => {
    for (const name of ['BLOB_READ_WRITE_TOKEN', 'WARM_STORE_URL']) delete process.env[name]
    await materialized()
    const stored = await storedEntries()
    const recortes = warmRecortes([{ id: 'lula' }, { id: 'tarcisio' }, { id: 'bolsonaro' }])
    assert.equal(recortes.length, 18)
    for (const r of recortes) {
      const res = await app.request(r.path)
      assert.equal(res.status, 200, r.path)
      assert.equal(res.headers.get('x-warm-store'), 'hit', r.path)
      assert.equal(await res.text(), splitEntry(stored.get(r.pathname)!)!.body, `${r.path} is the row's own body`)
    }
  })

  it('without a row the same process answers miss, and with x-warm-store-only 503 (AC12)', async () => {
    const [recorte] = warmRecortes([{ id: 'lula' }])
    await db.exec(`delete from warm_entries`)
    const plain = await app.request(recorte.path)
    assert.equal(plain.status, 200)
    assert.equal(plain.headers.get('x-warm-store'), 'miss')
    const only = await app.request(recorte.path, { headers: { 'x-warm-store-only': '1' } })
    assert.equal(only.status, 503)
  })
})
