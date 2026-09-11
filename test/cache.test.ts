import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { NO_STORE, cacheControl, cacheWindows } from '../src/cache.js'
import { app } from '../src/server.js'
import { seed } from './fixture.js'
import './close.js'

const HOUR = 3600
const SWR = `, stale-while-revalidate=${24 * HOUR}`
const ROLLING = `public, s-maxage=${6 * HOUR}${SWR}`
const TREND = `public, s-maxage=${1 * HOUR}${SWR}`
const STATIC = `public, s-maxage=${24 * HOUR}${SWR}`

const header = async (url: string) => {
  const res = await app.request(url)
  return { status: res.status, cache: res.headers.get('cache-control') }
}

describe('Cache-Control on /api reads', () => {
  before(seed)

  it('gives /api/people the long window: no now() in its SQL', async () => {
    assert.deepEqual(await header('/api/people'), { status: 200, cache: STATIC })
  })

  it('gives the days:30 routes the rolling window', async () => {
    for (const url of [
      '/api/people/lula/graph',
      '/api/people/lula/sources',
      '/api/people/lula/docs',
      '/api/people/lula/timeline',
      '/api/people/tarcisio/testimony?method=stub',
      '/api/tone',
      '/api/compare?a=lula&b=bolsonaro',
      '/api/people/lula/week',
    ])
      assert.deepEqual(await header(url), { status: 200, cache: ROLLING }, url)
  })

  it('gives the days:7 trend routes the short window', async () => {
    for (const url of ['/api/people/lula/rising', '/api/candidates'])
      assert.deepEqual(await header(url), { status: 200, cache: TREND }, url)
  })

  it('keeps the window when query parameters vary, since the CDN keys on the full URL', async () => {
    assert.deepEqual(await header('/api/people/lula/graph?days=365&sort=pmi&limit=5'), { status: 200, cache: ROLLING })
  })

  it('leaves the response body and status untouched', async () => {
    const res = await app.request('/api/people')
    assert.equal(res.status, 200)
    assert.deepEqual(
      ((await res.json()) as { id: string }[]).map((p) => p.id).sort(),
      ['bolsonaro', 'lula', 'tarcisio'],
    )
  })
})

describe('errors are never cached', () => {
  before(seed)

  it('does not store a 404 for an unknown person', async () => {
    for (const url of [
      '/api/people/nobody/graph',
      '/api/people/nobody/docs',
      '/api/people/nobody/testimony',
      '/api/compare?a=nobody&b=lula',
      '/api/compare?a=lula&b=nobody',
    ])
      assert.deepEqual(await header(url), { status: 404, cache: NO_STORE }, url)
  })

  it('does not store a 404 for an unknown /api route', async () => {
    assert.deepEqual(await header('/api/does-not-exist'), { status: 404, cache: NO_STORE })
  })

  it('does not store a non-200 status or a non-GET method', () => {
    assert.equal(cacheControl({ method: 'GET', path: '/api/people/lula/graph', status: 500 }), NO_STORE)
    assert.equal(cacheControl({ method: 'POST', path: '/api/people/lula/graph', status: 200 }), NO_STORE)
    assert.equal(cacheControl({ method: 'HEAD', path: '/api/people', status: 200 }), NO_STORE)
  })
})

describe('cacheWindows', () => {
  it('defaults to 24h/6h/1h with a day of stale-while-revalidate', () => {
    assert.deepEqual(cacheWindows({}), { static: 24 * HOUR, rolling: 6 * HOUR, trend: 1 * HOUR, swr: 24 * HOUR })
  })

  it('honours every knob', () => {
    assert.deepEqual(
      cacheWindows({ API_CACHE_STATIC_HOURS: '48', API_CACHE_HOURS: '12', API_CACHE_TREND_HOURS: '2', API_CACHE_SWR_HOURS: '36' }),
      { static: 48 * HOUR, rolling: 12 * HOUR, trend: 2 * HOUR, swr: 36 * HOUR },
    )
  })

  it('clamps to a week and to the floor', () => {
    const high = cacheWindows({ API_CACHE_STATIC_HOURS: '9999', API_CACHE_HOURS: '9999', API_CACHE_TREND_HOURS: '9999', API_CACHE_SWR_HOURS: '9999' })
    assert.deepEqual(high, { static: 168 * HOUR, rolling: 168 * HOUR, trend: 168 * HOUR, swr: 168 * HOUR })
    const low = cacheWindows({ API_CACHE_STATIC_HOURS: '-5', API_CACHE_HOURS: '0', API_CACHE_TREND_HOURS: '-1', API_CACHE_SWR_HOURS: '-1' })
    assert.deepEqual(low, { static: 1 * HOUR, rolling: 1 * HOUR, trend: 1 * HOUR, swr: 0 })
  })

  it('falls back to the default for a non-numeric value', () => {
    assert.deepEqual(cacheWindows({ API_CACHE_HOURS: 'six', API_CACHE_SWR_HOURS: '' }), cacheWindows({}))
  })

  it('drops stale-while-revalidate when its window is zero', () => {
    const w = cacheWindows({ API_CACHE_SWR_HOURS: '0' })
    assert.equal(cacheControl({ method: 'GET', path: '/api/people/lula/graph', status: 200 }, w), `public, s-maxage=${6 * HOUR}`)
  })

  it('applies an overridden window to the route tier it belongs to', () => {
    const w = cacheWindows({ API_CACHE_TREND_HOURS: '3' })
    assert.equal(cacheControl({ method: 'GET', path: '/api/candidates', status: 200 }, w), `public, s-maxage=${3 * HOUR}${SWR}`)
    assert.equal(cacheControl({ method: 'GET', path: '/api/people/lula/rising', status: 200 }, w), `public, s-maxage=${3 * HOUR}${SWR}`)
    assert.equal(cacheControl({ method: 'GET', path: '/api/people/lula/graph', status: 200 }, w), `public, s-maxage=${6 * HOUR}${SWR}`)
  })
})
