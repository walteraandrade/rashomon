import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

// src/ui/figures/lenses.ts, figure 6 (issue #206): mount(), its own controls, the selected
// word and the docs-card wiring. The backend route (/api/people/:id/lenses) and the atlas.html
// markup already ship (test/graph.test.ts, test/query.test.ts, test/server.test.ts,
// test/leitura-ui-acceptance.test.ts); this file is where figures/lenses.ts's own behaviour
// (mount, control-change reload, docs-card open/release) belongs once that module exists.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const modulePath = join(root, 'src', 'ui', 'figures', 'lenses.ts')

describe('figures/lenses.ts (issue #206)', () => {
  it('exists as its own module, mirroring figures/compare.ts', () => {
    assert.ok(existsSync(modulePath), 'src/ui/figures/lenses.ts is missing: figure 6 has no front-end module yet, so mount(), the control wiring and the docs-card integration the spec requires (issue #206 UI section, AC10-12) are not implemented')
  })
})
