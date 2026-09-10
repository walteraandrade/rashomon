import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { camara } from '../src/collectors/camara.js'
import { collectors, defaultSources } from '../src/collectors/index.js'
import type { Person } from '../src/types.js'

const readRepoFile = (relPath: string) => readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8')

// Issue #24. AC1 (Source/Person types include 'camara'/camaraId?) is a compile-time criterion
// covered by pnpm typecheck. The write path (tone null, the fixture doc's tag) is in
// test/store.test.ts, the parsers in test/query.test.ts, the docs in test/docs-drift.test.ts and
// the segmented control in test/atlas.test.ts.

describe('camara collector — AC2', () => {
  const src = readRepoFile('src/collectors/camara.ts')

  it('AC2: built only from sequential/sleep/slowGet in src/http.ts, no bespoke fetch or setTimeout retry', () => {
    assert.match(src, /from '\.\.\/http\.js'/)
    assert.match(src, /\bsequential\(/)
    assert.match(src, /\bsleep\(/)
    assert.match(src, /\bslowGet\(/)
    assert.doesNotMatch(src, /\bfetch\(/)
    assert.doesNotMatch(src, /\bsetTimeout\(/)
  })

  it('AC2: exports camara as an async (persons: Person[]) => Promise<RawDoc[]>', async () => {
    const result = camara([])
    assert.ok(result instanceof Promise)
    assert.deepEqual(await result, [])
  })
})

describe('camara collector — AC3', () => {
  it('AC3: a person without camaraId produces zero HTTP requests and zero thrown/logged errors', async () => {
    const noCamaraId: Person = { id: 'sem-camara', name: 'Sem Câmara', aliases: ['Sem Câmara'] }
    const errors: unknown[] = []
    const logs: unknown[] = []
    const originalError = console.error
    const originalLog = console.log
    console.error = (...args: unknown[]) => errors.push(args)
    console.log = (...args: unknown[]) => logs.push(args)
    let result: unknown
    try {
      result = await camara([noCamaraId])
    } finally {
      console.error = originalError
      console.log = originalLog
    }
    assert.deepEqual(result, [])
    assert.deepEqual(errors, [])
    assert.deepEqual(logs, [])
  })
})

describe('camara collector — AC4', () => {
  const src = readRepoFile('src/collectors/camara.ts')

  it('AC4: the RawDoc literal the collector returns always sets source: "camara" and never sets tone', () => {
    assert.match(src, /source:\s*'camara'/)
    assert.doesNotMatch(src, /\btone\s*:/)
  })
})

// Issue #24 shipped camara opt-in because no rate limit had been measured, only assumed;
// four unpaced requests to the live endpoint answered 200 in 490-730ms, so the collector
// now joins the default set like senado. It keeps its 429/5xx backoff, which senado lacks.
describe('camara collector — AC5', () => {
  it('AC5: collectors registers camara and defaultSources includes it', () => {
    assert.equal(typeof collectors.camara, 'function')
    assert.ok(defaultSources.includes('camara'), 'camara must be a default, not opt-in, source')
  })
})

describe('camara collector — AC11', () => {
  const seedData = JSON.parse(readRepoFile('seed.json')) as Array<{ id: string; camaraId?: string }>

  it('AC11: camaraId is set only on the verified sitting/former deputies, each a numeric id', () => {
    const withId = seedData.filter((p) => p.camaraId).map((p) => p.id).sort()
    assert.deepEqual(withId, ['bolsonaro', 'eduardo-bolsonaro', 'hugo-motta', 'nikolas'].sort())
    for (const p of seedData) if (p.camaraId) assert.match(p.camaraId, /^\d+$/)
  })
})
