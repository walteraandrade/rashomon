import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { db } from '../src/db.js'
import { camara } from '../src/collectors/camara.js'
import { collectors, defaultSources } from '../src/collectors/index.js'
import { insertDoc, tonedSources } from '../src/store.js'
import { parseRisingQuery, parseSourceList, parseTimelineQuery } from '../src/query.js'
import type { Person } from '../src/types.js'
import { persons, seed } from './fixture.js'

const readRepoFile = (relPath: string) => readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8')

// AC1 (Source/Person types include 'camara'/camaraId?, pnpm typecheck passes) is a
// compile-time criterion: this suite's runner (tsx) transpiles without type-checking,
// so it cannot be exercised as a runtime assertion. Verified instead by running
// `pnpm typecheck` directly (green on the diff at time of writing) — see report.

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

describe('camara collector — AC5', () => {
  it('AC5: collectors registers camara, but defaultSources excludes it', () => {
    assert.equal(typeof collectors.camara, 'function')
    assert.ok(!defaultSources.includes('camara'))
  })
})

describe('camara collector — AC6', () => {
  before(seed)

  it('AC6: tonedSources stays exactly [gdelt, gkg]', () => {
    assert.deepEqual(tonedSources, ['gdelt', 'gkg'])
  })

  it('AC6: a camara doc lands with tone = null even if a buggy RawDoc sets a numeric tone', async () => {
    const uri = 'https://www.camara.leg.br/discursos/999999/2020-01-01T00:00'
    await insertDoc(
      { source: 'camara', uri, text: 'Fulano: teste de tone indevido', publishedAt: new Date().toISOString(), tone: 42 },
      persons,
    )
    const row = (await db.query<{ source: string; tone: number | null }>(`select source, tone from docs where uri = $1`, [uri])).rows[0]
    assert.deepEqual(row, { source: 'camara', tone: null })
  })
})

describe('camara collector — AC7', () => {
  it('AC7: parseSourceList("camara") resolves to "camara"', () => {
    assert.equal(parseSourceList('camara'), 'camara')
    assert.equal(parseSourceList('camara,gdelt'), 'camara,gdelt')
  })
})

describe('camara collector — AC8', () => {
  it('AC8: parseRisingQuery/parseTimelineQuery resolve source: camara to camara, not all', () => {
    assert.equal(parseRisingQuery({ source: 'camara' }).source, 'camara')
    assert.equal(parseTimelineQuery({ source: 'camara' }).source, 'camara')
  })
})

// AC9 (adding the camara fixture doc requires zero changes to any pinned literal
// elsewhere) is a diff-shape criterion, not a runtime assertion: verified by running
// the full pre-existing suite (graph/signature/timeline/tone/...) unmodified alongside
// the new fixture doc and confirming every pinned assertion still holds — see report.

describe('camara collector — AC10', () => {
  before(seed)

  it('AC10: the camara fixture doc tags exactly its own person, tone null, source camara', async () => {
    const uri = 'https://www.camara.leg.br/discursos/74847/2018-01-01T10:00'
    const tagged = (
      await db.query<{ person_id: string }>(
        `select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`,
        [uri],
      )
    ).rows.map((r) => r.person_id)
    assert.deepEqual(tagged, ['bolsonaro'])
    const row = (await db.query<{ source: string; tone: number | null }>(`select source, tone from docs where uri = $1`, [uri])).rows[0]
    assert.deepEqual(row, { source: 'camara', tone: null })
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

describe('camara collector — AC12', () => {
  const readme = readRepoFile('README.md')

  it('AC12: README documents camaraId in the seed bullet, a camara paragraph, and its opt-in status', () => {
    assert.match(readme, /camaraId/)
    assert.match(readme, /dadosabertos\.camara\.leg\.br/)
    assert.match(readme, /pnpm ingest camara/)
    assert.match(readme, /off by default/i)
  })
})

describe('camara collector — AC14', () => {
  it('AC14: segSource control has a camara entry, driven by the one shared buildSeg list/handler (issue #37: SOURCE_SEGMENTS, not a design-5.html grep)', async () => {
    const { SOURCE_SEGMENTS } = await import('../public/js/format.js')
    assert.ok(
      SOURCE_SEGMENTS.some((entry: string[]) => entry[0] === 'camara' && entry[1] === 'câmara'),
      'SOURCE_SEGMENTS must list a camara entry, the single source feeding design-5.html\'s one buildSeg(\'segSource\', SOURCE_SEGMENTS, \'source\') call',
    )
    // buildSeg itself takes one (containerId, options, key) triple and wires every option
    // through the same click handler — there is no per-option branch to special-case camara.
  })
})
