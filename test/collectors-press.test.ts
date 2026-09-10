import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { collectors, defaultSources } from '../src/collectors/index.js'

const readRepoFile = (relPath: string) => readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8')

const FAMILIES = ['juridico', 'oficial', 'nicho'] as const

// The three press families (issue #22) are thin lists of feeds over fetchFeed. AC1 (the Source
// union) is compile-time; the write path is in test/store.test.ts, the parsers in
// test/query.test.ts, the labels in test/format.test.ts, the segmented control in
// test/figures-atlas.test.ts and the docs in test/docs-drift.test.ts.

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
