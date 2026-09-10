import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { purgeThemes, resolveTarget } from '../src/purge.js'
import { docs, insertTestimony, seed } from './fixture.js'
import './close.js'

// main() itself is never imported by tests (it calls process.argv, migrate() and db.close());
// resolveTarget is the pure piece of it that decides whether an argument is a known source,
// one of the two maintenance targets, or a usage error.
describe('purge target resolution (issue #108)', () => {
  it('accepts a known source, orphan-terms and themes', () => {
    assert.equal(resolveTarget('gkg'), 'gkg')
    assert.equal(resolveTarget('orphan-terms'), 'orphan-terms')
    assert.equal(resolveTarget('themes'), 'themes')
  })

  it('throws the usage error, naming all three targets, when the argument is missing or unrecognized', () => {
    const usage = { message: 'usage: pnpm purge <source|orphan-terms|themes>' }
    assert.throws(() => resolveTarget(undefined), usage)
    assert.throws(() => resolveTarget('bogus'), usage)
    assert.throws(() => resolveTarget(''), usage)
  })
})

// Pre-migration shape: a gkg doc with GDELT theme codes staged in extra_terms and expanded into
// doc_terms, plus a testimony row still under the pre-revision label. Nothing in the current
// fixture writes either any more (issue #108), so this simulates the state a production
// database was actually left in, by writing it directly rather than through insertDoc.
const seedLegacyThemeState = async () => {
  const { rows } = await db.query<{ id: number }>(`select id from docs where uri = $1`, [docs[3].uri])
  const docId = rows[0].id
  await db.query(`update docs set extra_terms = '[{"term":"tax_econ","kind":"theme"}]'::jsonb where id = $1`, [docId])
  await db.query(`insert into doc_terms (doc_id, term, kind) values ($1, 'tax_econ', 'theme') on conflict do nothing`, [docId])
  await insertTestimony(docs[2].uri, 'tarcisio', 'kikori:q8', 5)
  await insertTestimony(docs[2].uri, 'tarcisio', 'kikori:q8:d03d785300c13e97', 6)
  await insertTestimony(docs[2].uri, 'tarcisio', 'stub', 7)
}

describe('purge themes (issue #108)', () => {
  before(seed)

  it('clears extra_terms and theme-kind doc_terms, deletes only the pre-revision kikori row', async () => {
    await seedLegacyThemeState()

    await purgeThemes()

    const { rows: themeTerms } = await db.query<{ n: number }>(`select count(*)::int as n from doc_terms where kind = 'theme'`)
    assert.equal(themeTerms[0].n, 0)

    const { rows: extra } = await db.query<{ n: number }>(`select count(*)::int as n from docs where extra_terms <> '[]'::jsonb`)
    assert.equal(extra[0].n, 0)

    const { rows: methods } = await db.query<{ method: string }>(
      `select dt.method from doc_testimony dt join docs d on d.id = dt.doc_id where d.uri = $1 order by 1`,
      [docs[2].uri],
    )
    assert.deepEqual(
      methods.map((r) => r.method),
      ['kikori:q8:d03d785300c13e97', 'stub'],
    )
  })

  it('runs again against a database with nothing left to purge, without error and reporting zero', async () => {
    const before = {
      terms: (await db.query<{ n: number }>(`select count(*)::int as n from doc_terms where kind = 'theme'`)).rows[0].n,
      extra: (await db.query<{ n: number }>(`select count(*)::int as n from docs where extra_terms <> '[]'::jsonb`)).rows[0].n,
      testimony: (await db.query<{ n: number }>(`select count(*)::int as n from doc_testimony where method like 'kikori:%' and method not like 'kikori:%:%'`)).rows[0].n,
    }
    assert.deepEqual(before, { terms: 0, extra: 0, testimony: 0 }, 'sanity: nothing left over from the previous run')

    await assert.doesNotReject(purgeThemes())

    const after = {
      terms: (await db.query<{ n: number }>(`select count(*)::int as n from doc_terms where kind = 'theme'`)).rows[0].n,
      extra: (await db.query<{ n: number }>(`select count(*)::int as n from docs where extra_terms <> '[]'::jsonb`)).rows[0].n,
      testimony: (await db.query<{ n: number }>(`select count(*)::int as n from doc_testimony where method like 'kikori:%' and method not like 'kikori:%:%'`)).rows[0].n,
    }
    assert.deepEqual(after, { terms: 0, extra: 0, testimony: 0 })
  })
})
