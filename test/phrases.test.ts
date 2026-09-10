import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { db } from '../src/db.js'
import { buildPhrases, loadPhrases, resetPhraseStage, stagePhrases } from '../src/phrases.js'
import { seed } from './fixture.js'
import './close.js'

// The collocation lexicon in src/phrases.ts: which staged pairs the two floors keep. The fixture
// is small, so the count floor is lowered to 2 or 3: what is under test is which pairs the floors
// keep, never the production numbers. Extraction against a lexicon is in test/extract.test.ts,
// and the reindex that builds one over the corpus is in test/reindex.test.ts.

describe('the lexicon keeps pairs that stick and drops pairs that merely co-occur', () => {
  before(async () => {
    await seed()
    await resetPhraseStage()
  })

  it('keeps a pair whose rarer word has nowhere else to be, and drops a pair riding a common word', async () => {
    process.env.MIN_PHRASE_COUNT = '3'
    process.env.MIN_PHRASE_PERCENT = '35'
    // "turno" appears only inside "primeiro turno" (3/3 = 1.0). "dias" appears eight times and
    // only twice after "faltam" (2/8 = 0.25), which is exactly the shape of the noise the
    // stickiness floor exists to reject — and its count is under the floor besides.
    await stagePhrases([
      'primeiro turno decidido',
      'primeiro turno apertado',
      'primeiro turno tranquilo',
      'faltam dias apenas',
      'faltam dias novamente',
      'poucos dias restantes',
      'longos dias seguidos',
      'outros dias quaisquer',
      'muitos dias passados',
      'certos dias marcados',
      'varios dias contados',
    ])
    await buildPhrases()
    const lexicon = await loadPhrases()
    assert.ok(lexicon.has('primeiro turno'), 'a pair its rarer word never leaves must be a phrase')
    assert.ok(!lexicon.has('faltam dias'), 'a pair riding a common word must not be a phrase')
  })

  it('empties the staging table once the lexicon is built', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from phrase_stage`)
    assert.equal(rows[0].n, 0)
  })

  it('rebuilds whole, so a pair that stopped clearing the floors leaves', async () => {
    await resetPhraseStage()
    await stagePhrases(['outra coisa qualquer'])
    await buildPhrases()
    assert.equal((await loadPhrases()).has('primeiro turno'), false)
  })
})
