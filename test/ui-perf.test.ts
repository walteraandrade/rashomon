import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { measures, routeOf, span } from '../src/ui/perf.js'

// src/ui/perf.ts: User Timing marks for the page. No DOM, no network. Durations are never
// asserted beyond non-negativity; the shape of the entries is the contract.

describe('span', () => {
  beforeEach(() => performance.clearMeasures())

  it('records one measure, named as given, when its closer runs', () => {
    const done = span('figure:atlas')
    const ms = done({ person: 'lula', nodes: 12 })
    const entries = performance.getEntriesByName('figure:atlas', 'measure') as PerformanceMeasure[]
    assert.equal(entries.length, 1)
    assert.ok(ms >= 0)
    assert.ok(Math.abs(entries[0].duration - ms) < 1)
    assert.deepEqual(entries[0].detail, { person: 'lula', nodes: 12 })
  })

  it('records nothing until the closer runs, so a superseded request leaves no entry', () => {
    span('figure:compare')
    assert.deepEqual(performance.getEntriesByName('figure:compare', 'measure'), [])
  })

  it('defaults the detail to an empty object', () => {
    span('figure:docs')()
    const [entry] = performance.getEntriesByName('figure:docs', 'measure') as PerformanceMeasure[]
    assert.deepEqual(entry.detail, {})
  })
})

describe('routeOf', () => {
  it('is the last path segment, querystring dropped', () => {
    assert.equal(routeOf('/api/people/lula/graph?days=30&sort=pmi'), 'graph')
    assert.equal(routeOf('/api/people/tarc%C3%ADsio/docs?term=x'), 'docs')
    assert.equal(routeOf('/api/compare?a=lula&b=bolsonaro'), 'compare')
    assert.equal(routeOf('/api/people'), 'people')
    assert.equal(routeOf(''), '')
  })
})

describe('measures', () => {
  beforeEach(() => performance.clearMeasures())

  it('lists recorded measures oldest first, filtered by prefix', () => {
    span('api:graph')()
    span('figure:atlas')()
    span('api:sources')()
    assert.deepEqual(measures('api:').map((e) => e.name), ['api:graph', 'api:sources'])
    assert.deepEqual(measures().map((e) => e.name), ['api:graph', 'figure:atlas', 'api:sources'])
  })
})
