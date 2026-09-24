import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { MINS } from '../src/query.js'
import * as scoring from '../src/scoring.js'
import { isName, pmiRank, signatureFloor, sortKey } from '../src/scoring.js'
import { sql } from '../src/sql.js'
import { docsText } from './docs.js'

const repoFile = (relPath: string) => readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8')

describe('scoring fragments', () => {
  it('pmiRank renders pmi * ln(1 + <count>) and binds nothing', () => {
    const frag = pmiRank(sql.raw('c_pt'))
    assert.equal(frag.text, 'pmi * ln(1 + c_pt)')
    assert.deepEqual(frag.values, [])
  })

  it("sortKey('pmi', ...) wraps pmiRank in the case's then branch, binding sort once", () => {
    const frag = sortKey('pmi', sql.raw('count'))
    assert.equal(frag.text, "(case when $1 = 'pmi' then pmi * ln(1 + count) else count end)")
    assert.deepEqual(frag.values, ['pmi'])
  })

  it("sortKey('count', ...) selects the bare count column in the case's else branch", () => {
    const frag = sortKey('count', sql.raw('count'))
    assert.equal(frag.text, "(case when $1 = 'pmi' then pmi * ln(1 + count) else count end)")
    assert.deepEqual(frag.values, ['count'])
  })

  it('signatureFloor renders greatest(3, <about> * 0.05)', () => {
    const frag = signatureFloor(sql.raw('np.total'))
    assert.equal(frag.text, 'greatest(3, np.total * 0.05)')
    assert.deepEqual(frag.values, [])
  })

  it('isName ORs the bare-word and phrase checks and binds names twice', () => {
    const names = ['Lula', 'Silva']
    const frag = isName(sql.raw('t.term'), names)
    assert.equal(
      frag.text,
      "(t.term = any($1::text[]) or (position(' ' in t.term) > 0 and string_to_array(t.term, ' ') && $2::text[]))",
    )
    assert.deepEqual(frag.values, [names, names])
  })

  it('fragments compose inside sql.join, one row_number clause per MINS entry, placeholders numbered in order', () => {
    const byPmi = (m: number) => sql.raw(`by_pmi_${m}`)
    const ranks = MINS.map(
      (m) => sql`row_number() over (partition by source, kind, c_pt >= ${m} order by ${pmiRank(sql.raw('c_pt'))} desc, term, kind) as ${byPmi(m)}`,
    )
    const joined = sql.join(ranks)
    const placeholders = joined.text.match(/\$\d+/g) ?? []
    assert.deepEqual(placeholders, placeholders.map((_, i) => `$${i + 1}`))
    assert.deepEqual(joined.values, MINS)
    assert.equal((joined.text.match(/row_number\(\)/g) ?? []).length, MINS.length)
    for (const m of MINS) assert.ok(joined.text.includes(`as by_pmi_${m}`))
  })
})

describe('scoring.ts is the single home for the pmi ordering, signature floor and own-name filter', () => {
  it('exports exactly pmiRank, sortKey, signatureFloor, isName and no namePhrase', () => {
    assert.deepEqual(Object.keys(scoring).sort(), ['isName', 'pmiRank', 'signatureFloor', 'sortKey'])
  })

  it('no namePhrase export exists anywhere in the codebase', () => {
    const grep = (path: string) => repoFile(path)
    for (const path of ['src/graph.ts', 'src/aggregate.ts', 'src/scoring.ts']) {
      assert.ok(!/export\s+(const|function)\s+namePhrase\b/.test(grep(path)), `${path} must not export namePhrase`)
    }
  })

  it('src/graph.ts has no local sortKey declaration and no namePhrase function', () => {
    const text = repoFile('src/graph.ts')
    assert.ok(!/const sortKey = sql`/.test(text))
    assert.ok(!/function namePhrase/.test(text))
    assert.ok(!/const namePhrase/.test(text))
  })

  it('graph.ts and aggregate.ts contain the pmi/signature fragments only inside comments', () => {
    for (const path of ['src/graph.ts', 'src/aggregate.ts']) {
      const codeLines = repoFile(path)
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
      const code = codeLines.join('\n')
      assert.ok(!code.includes('pmi * ln(1 + '), `${path} must not inline the pmi formula outside scoring.ts`)
      assert.ok(!code.includes('greatest(3,'), `${path} must not inline the signature floor outside scoring.ts`)
    }
  })

  it('graph.ts calls isName at every own-name filter site (graphQuery, risingQuery, weekQuery, both compareSideCte sides, compareQuery)', () => {
    const text = repoFile('src/graph.ts')
    const calls = text.match(/isName\(/g) ?? []
    assert.ok(calls.length >= 6, `expected at least 6 isName call sites, found ${calls.length}`)
  })

  it('aggregate.ts calls isName instead of a hand-written own-name predicate', () => {
    const text = repoFile('src/aggregate.ts')
    assert.ok(text.includes('isName('), 'aggregate.ts must call isName')
  })

  it('CLAUDE.md names src/scoring.ts as where the pmi ordering, signature floor and own-name filter live', () => {
    const claudeMd = repoFile('CLAUDE.md')
    assert.ok(/scoring\.ts/.test(claudeMd), 'CLAUDE.md must mention src/scoring.ts')
    const scoringSentence = claudeMd
      .split('\n')
      .find((line) => line.includes('`src/scoring.ts`') && line.includes('pmi'))
    assert.ok(scoringSentence, 'CLAUDE.md must describe src/scoring.ts and the pmi ordering together')
  })

  it('the docs state the pmi-ordering and signature-floor formulas live in src/scoring.ts', () => {
    assert.match(docsText, /`src\/scoring\.ts`/)
    const lines = docsText.split('\n')
    const idx = lines.findIndex((line) => line.includes('scoring.ts'))
    assert.ok(idx >= 0, 'a docs line must name src/scoring.ts')
    const window = lines.slice(Math.max(0, idx - 5), idx + 1).join('\n')
    assert.ok(
      /pmi/i.test(window) && /(greatest\(3|signature)/i.test(window),
      'the docs near src/scoring.ts must also describe the pmi ordering and the signature floor',
    )
  })
})
