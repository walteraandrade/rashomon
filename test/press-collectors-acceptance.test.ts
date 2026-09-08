import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { db } from '../src/db.js'
import { collectors, defaultSources } from '../src/collectors/index.js'
import { insertDoc, tonedSources } from '../src/store.js'
import { parseRisingQuery, parseSourceList, parseTimelineQuery } from '../src/query.js'
import { persons, seed } from './fixture.js'
import { SOURCE_SEGMENTS, sourceLabels } from '../public/js/format.js'
import { createHandlers } from '../public/js/app.js'

const readRepoFile = (relPath: string) => readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8')

const FAMILIES = ['juridico', 'oficial', 'nicho'] as const

// AC1 (Source union gains 'juridico' | 'oficial' | 'nicho', collectors: Record<Source, Collector>
// registers all three) is a compile-time criterion: this suite's runner (tsx) transpiles without
// type-checking, so it cannot be exercised as a runtime assertion. Verified instead by running
// `pnpm typecheck` directly (green on the diff at time of writing) — see report.

describe('press collectors — AC2', () => {
  it('AC2: collectors registers juridico/oficial/nicho as functions, and defaultSources includes all three', () => {
    for (const family of FAMILIES) {
      assert.equal(typeof collectors[family], 'function', `${family} must be a registered collector`)
      assert.ok(defaultSources.includes(family), `${family} must ship in defaultSources per the reversed opt-in decision`)
    }
  })
})

describe('press collectors — AC3', () => {
  for (const family of FAMILIES) {
    it(`AC3: src/collectors/${family}.ts imports fetchFeed and has no bespoke fetch/XML parsing`, () => {
      const src = readRepoFile(`src/collectors/${family}.ts`)
      assert.match(src, /from '\.\/rss\.js'/, `${family}.ts must import fetchFeed from ./rss.js`)
      assert.match(src, /\bfetchFeed\(/)
      assert.match(src, /feeds\.map\(fetchFeed\(/, `${family}.ts must call fetchFeed once per feed url via feeds.map`)
      assert.doesNotMatch(src, /\bfetch\(/, `${family}.ts must not call fetch() itself`)
      assert.doesNotMatch(src, /XMLParser|parser\.parse/, `${family}.ts must not do its own XML parsing`)
    })
  }
})

describe('press collectors — AC4', () => {
  // Unlike camara/senado, juridico/oficial/nicho have no camaraId/senadoId-style gate: they
  // always fetch every feed regardless of the persons argument, so there is no early-return
  // branch that lets [] resolve without a network call. Per the spec's own fallback for this
  // exact case, this is checked by static analysis of the source text instead of invoking the
  // collector — CLAUDE.md forbids hitting external APIs from tests, and mirrors
  // senado-independent-acceptance.test.ts's AC3 technique (reading the file rather than mocking
  // a live fetch).
  for (const family of FAMILIES) {
    it(`AC4: ${family}.ts builds every RawDoc with source: '${family}' via fetchFeed('${family}')`, () => {
      const src = readRepoFile(`src/collectors/${family}.ts`)
      assert.match(src, new RegExp(`fetchFeed\\('${family}'\\)`), `${family}.ts must call fetchFeed('${family}'), which is what stamps every RawDoc's source field`)
      assert.doesNotMatch(src, /\btone\s*:/, `${family}.ts must never set a tone field itself`)
    })
  }
})

describe('press collectors — AC5', () => {
  before(seed)

  it('AC5: tonedSources stays exactly [gdelt, gkg]', () => {
    assert.deepEqual(tonedSources, ['gdelt', 'gkg'])
  })

  for (const family of FAMILIES) {
    it(`AC5: a ${family} doc lands with tone = null even if a buggy RawDoc sets a numeric tone`, async () => {
      const uri = `https://example.org/press-tone-${family}`
      await insertDoc({ source: family, uri, text: `Fulano: teste de tone indevido em ${family}`, publishedAt: new Date().toISOString(), tone: 42 }, persons)
      const row = (await db.query<{ source: string; tone: number | null }>(`select source, tone from docs where uri = $1`, [uri])).rows[0]
      assert.deepEqual(row, { source: family, tone: null })
    })
  }
})

describe('press collectors — AC6', () => {
  it('AC6: parseSourceList resolves single and comma-separated new tokens, order preserved, deduped', () => {
    assert.equal(parseSourceList('juridico'), 'juridico')
    assert.equal(parseSourceList('juridico,oficial,nicho'), 'juridico,oficial,nicho')
    assert.equal(parseSourceList('juridico,juridico,oficial'), 'juridico,oficial')
  })
})

describe('press collectors — AC7', () => {
  it('AC7: parseRisingQuery/parseTimelineQuery resolve the new tokens to themselves, not all', () => {
    assert.equal(parseRisingQuery({ source: 'oficial' }).source, 'oficial')
    assert.equal(parseTimelineQuery({ source: 'nicho' }).source, 'nicho')
    assert.equal(parseRisingQuery({ source: 'juridico' }).source, 'juridico')
    assert.equal(parseTimelineQuery({ source: 'juridico' }).source, 'juridico')
    // an unrelated bogus token must still fall back to 'all', proving the new tokens were
    // added rather than the whole check being loosened
    assert.equal(parseRisingQuery({ source: 'not-a-real-source' }).source, 'all')
    assert.equal(parseTimelineQuery({ source: 'not-a-real-source' }).source, 'all')
  })
})

describe('press collectors — AC8', () => {
  const expected: Record<(typeof FAMILIES)[number], string> = { juridico: 'jurídico', oficial: 'oficial', nicho: 'nicho' }

  for (const family of FAMILIES) {
    it(`AC8: SOURCE_SEGMENTS has ['${family}', '${expected[family]}'] wired through the shared source handler`, () => {
      assert.deepEqual(
        SOURCE_SEGMENTS.find(([value]) => value === family),
        [family, expected[family]],
      )
      const calls: string[] = []
      const handlers = createHandlers({
        setSource: (value: string) => calls.push(`setSource:${value}`),
        load: () => calls.push('load'),
        updateHeader: () => calls.push('updateHeader'),
      })
      handlers.source(family)()
      assert.deepEqual(calls, [`setSource:${family}`, 'load', 'updateHeader'], `${family} must reuse the same handler every other source uses`)
    })
  }
})

describe('press collectors — AC9', () => {
  it('AC9: sourceLabels has the three pt-BR labels', () => {
    assert.equal(sourceLabels.juridico, 'Jurídico')
    assert.equal(sourceLabels.oficial, 'Oficial')
    assert.equal(sourceLabels.nicho, 'Nicho')
  })
})

// AC10 (adding the three fixture docs requires zero changes to any pre-existing pinned
// literal elsewhere) is a diff-shape criterion, not a runtime assertion: verified by running
// the full pre-existing suite unmodified alongside the new fixture docs and confirming every
// pinned assertion still holds — see report.

describe('press collectors — AC11', () => {
  before(seed)

  it('AC11: the juridico fixture doc tags exactly bolsonaro, tone null, source juridico', async () => {
    const uri = 'https://noticias.stf.jus.br/46'
    const tagged = (
      await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [uri])
    ).rows.map((r) => r.person_id)
    assert.deepEqual(tagged, ['bolsonaro'])
    const row = (await db.query<{ source: string; tone: number | null }>(`select source, tone from docs where uri = $1`, [uri])).rows[0]
    assert.deepEqual(row, { source: 'juridico', tone: null })
  })

  it('AC11: the oficial fixture doc tags exactly lula, tone null, source oficial', async () => {
    const uri = 'https://agenciabrasil.ebc.com.br/47'
    const tagged = (
      await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [uri])
    ).rows.map((r) => r.person_id)
    assert.deepEqual(tagged, ['lula'])
    const row = (await db.query<{ source: string; tone: number | null }>(`select source, tone from docs where uri = $1`, [uri])).rows[0]
    assert.deepEqual(row, { source: 'oficial', tone: null })
  })

  it('AC11: the nicho fixture doc tags exactly bolsonaro, tone null, source nicho', async () => {
    const uri = 'https://cartacapital.com.br/48'
    const tagged = (
      await db.query<{ person_id: string }>(`select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1 order by 1`, [uri])
    ).rows.map((r) => r.person_id)
    assert.deepEqual(tagged, ['bolsonaro'])
    const row = (await db.query<{ source: string; tone: number | null }>(`select source, tone from docs where uri = $1`, [uri])).rows[0]
    assert.deepEqual(row, { source: 'nicho', tone: null })
  })
})

// AC12 (README's four source=all|... enumerations and the collectors' prose) and AC13 (a real
// `pnpm ingest juridico oficial nicho` run plus the manual before/after doc-count/pmi report)
// are documented in the report, not asserted here, mirroring how camara-acceptance.test.ts
// treats its own AC12.

// AC14 (pnpm typecheck and pnpm test both green, no change to src/graph.ts:163,165) is verified
// by running those commands directly — see report.
