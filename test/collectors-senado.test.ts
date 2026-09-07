import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { senado } from '../src/collectors/senado.js'
import type { Person } from '../src/types.js'

// No network call is exercised here: every person below lacks senadoId, so the collector
// must short-circuit before calling sequential/slowGet at all (CLAUDE.md: no external
// calls in tests). A hung/failed request would time the test out rather than resolve fast.
describe('senado collector (issue #25)', () => {
  it('AC2: returns [] for an empty person list, no request made', async () => {
    assert.deepEqual(await senado([]), [])
  })

  it('AC2: returns [] when every person lacks senadoId, no request made', async () => {
    const persons: Person[] = [
      { id: 'lula', name: 'Lula', aliases: ['Lula'] },
      { id: 'tarcisio', name: 'Tarcísio', aliases: ['Tarcísio'] },
    ]
    assert.deepEqual(await senado(persons), [])
  })
})
