import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MINS } from '../src/query.js'
import * as scoring from '../src/scoring.js'
import { isName, pmiRank, signatureFloor, sortKey } from '../src/scoring.js'
import { sql } from '../src/sql.js'
import { docsText } from './docs.js'

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

  it('the docs state the pmi-ordering and signature-floor formulas live in src/scoring.ts', () => {
    assert.match(docsText, /src\/scoring\.ts/)
    const paragraph = docsText.split(/\n\s*\n/).find((block) => block.includes('scoring.ts'))
    assert.ok(paragraph, 'a docs paragraph must name src/scoring.ts')
    assert.ok(paragraph.includes('ln(1 + count)'), 'the paragraph naming src/scoring.ts must state the pmi-ordering formula')
    assert.ok(paragraph.includes('greatest(3'), 'the paragraph naming src/scoring.ts must state the signature-floor formula')
  })
})
