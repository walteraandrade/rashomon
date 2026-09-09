import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { endpoint, json, loadDocs, loadGraph, loadPeople, loadSources, params } from '../public/js/api.js'

// Never hits the network (CLAUDE.md's hard constraint): every test stubs global.fetch and
// restores it afterward, so this suite never depends on a running server or DATA_DIR.
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const stubFetch = (ok: boolean, body: unknown) => {
  const calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return { ok, status: ok ? 200 : 500, json: async () => body } as Response
  }) as typeof fetch
  return calls
}

describe('endpoint', () => {
  it('URL-encodes the person id', () => {
    assert.equal(endpoint('tarcísio'), '/api/people/tarc%C3%ADsio')
  })
})

describe('params', () => {
  it('builds the querystring the graph/sources/docs routes expect', () => {
    const p = params({ days: '30', sort: 'pmi', limit: '18', source: 'all', domain: 'all' })
    assert.equal(p.get('days'), '30')
    assert.equal(p.get('sort'), 'pmi')
    assert.equal(p.get('limit'), '18')
    assert.equal(p.get('min'), '2')
    // Not 'all': the atlas asks for words, hashtags and phrases, and leaves GDELT's own
    // theme codes out of the default recorte (see ATLAS_KINDS in api.js).
    assert.equal(p.get('kind'), 'word,hashtag,phrase')
    assert.equal(p.get('source'), 'all')
    assert.equal(p.get('domain'), 'all')
  })

  it('lets an explicit kind/min override the defaults', () => {
    const p = params({ days: '7', sort: 'count', limit: '12', source: 'gdelt', domain: 'estadao.com.br', kind: 'hashtag', min: '5' })
    assert.equal(p.get('kind'), 'hashtag')
    assert.equal(p.get('min'), '5')
  })
})

describe('json', () => {
  it('returns the parsed body on a 200', async () => {
    stubFetch(true, { ok: true })
    assert.deepEqual(await json('/api/people'), { ok: true })
  })

  it('throws with the HTTP status on a non-ok response, never returning a fake payload', async () => {
    stubFetch(false, { error: 'nope' })
    await assert.rejects(() => json('/api/people'), /HTTP 500/)
  })
})

describe('loadPeople / loadGraph / loadSources / loadDocs', () => {
  it('call the exact routes CLAUDE.md documents as the stable API contract', async () => {
    const calls = stubFetch(true, [])
    await loadPeople(undefined)
    assert.equal(calls[0].url, '/api/people')

    await loadGraph('lula', new URLSearchParams({ days: '30' }), undefined)
    assert.equal(calls[1].url, '/api/people/lula/graph?days=30')

    await loadSources('lula', new URLSearchParams({ days: '30' }), undefined)
    assert.equal(calls[2].url, '/api/people/lula/sources?days=30')

    await loadDocs('lula', new URLSearchParams({ days: '30' }), undefined)
    assert.equal(calls[3].url, '/api/people/lula/docs?days=30')
  })
})
