import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { purgeThemes, resolveTarget } from '../src/purge.js'
import { docs, insertTestimony, reseed, seed } from './fixture.js'
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

// A theme-kind element remaining in extra_terms, whether alone or beside a live org element
// (issue #209 AC7): the count purgeThemes must drive to zero, unlike a blanket "extra_terms <>
// '[]'" check, which a surviving org element would now legitimately fail.
const themeElementCount = async () =>
  (await db.query<{ n: number }>(`select count(*)::int as n from docs where exists (select 1 from jsonb_array_elements(extra_terms) e where e->>'kind' = 'theme')`)).rows[0].n

// Pre-migration shape: a gkg doc with GDELT theme codes staged in extra_terms and expanded into
// doc_terms, plus a testimony row still under the pre-revision label. Nothing in the current
// fixture writes either any more (issue #108), so this simulates the state a production
// database was actually left in, by writing it directly rather than through insertDoc. A live
// org element (issue #209) sits in the same doc's extra_terms/doc_terms, since a real database
// can hold both a leftover theme row and a genuine org row on the same doc until purge themes
// (which must strip only the theme one) runs.
const seedLegacyThemeState = async () => {
  const { rows } = await db.query<{ id: number }>(`select id from docs where uri = $1`, [docs[3].uri])
  const docId = rows[0].id
  await db.query(`update docs set extra_terms = '[{"term":"tax_econ","kind":"theme"},{"term":"petrobras","kind":"org"}]'::jsonb where id = $1`, [docId])
  await db.query(`insert into doc_terms (doc_id, term, kind) values ($1, 'tax_econ', 'theme') on conflict do nothing`, [docId])
  await db.query(`insert into doc_terms (doc_id, term, kind) values ($1, 'petrobras', 'org') on conflict do nothing`, [docId])
  await insertTestimony(docs[2].uri, 'tarcisio', 'kikori:q8', 5)
  await insertTestimony(docs[2].uri, 'tarcisio', 'kikori:q8:d03d785300c13e97', 6)
  await insertTestimony(docs[2].uri, 'tarcisio', 'stub', 7)
}

describe('purge themes (issue #108)', () => {
  before(seed)

  it('clears theme-kind extra_terms and doc_terms, keeps a live org element and its doc_terms row intact, deletes only the pre-revision kikori row (issue #209 AC7)', async () => {
    await seedLegacyThemeState()
    const { rows: docRow } = await db.query<{ id: number }>(`select id from docs where uri = $1`, [docs[3].uri])
    const docId = docRow[0].id

    await purgeThemes()

    const { rows: themeTerms } = await db.query<{ n: number }>(`select count(*)::int as n from doc_terms where kind = 'theme'`)
    assert.equal(themeTerms[0].n, 0)

    assert.equal(await themeElementCount(), 0)

    const { rows: extra } = await db.query<{ extra_terms: { term: string; kind: string }[] }>(`select extra_terms from docs where id = $1`, [docId])
    assert.deepEqual(extra[0].extra_terms, [{ term: 'petrobras', kind: 'org' }], 'the org element must survive while the theme element is stripped')

    const { rows: orgTerms } = await db.query<{ term: string }>(`select term from doc_terms where doc_id = $1 and kind = 'org'`, [docId])
    assert.deepEqual(orgTerms.map((r) => r.term), ['petrobras'], 'the live org doc_terms row must survive purge themes')

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
      extra: await themeElementCount(),
      testimony: (await db.query<{ n: number }>(`select count(*)::int as n from doc_testimony where method like 'kikori:%' and method not like 'kikori:%:%'`)).rows[0].n,
    }
    assert.deepEqual(before, { terms: 0, extra: 0, testimony: 0 }, 'sanity: nothing left over from the previous run')

    await assert.doesNotReject(purgeThemes())

    const after = {
      terms: (await db.query<{ n: number }>(`select count(*)::int as n from doc_terms where kind = 'theme'`)).rows[0].n,
      extra: await themeElementCount(),
      testimony: (await db.query<{ n: number }>(`select count(*)::int as n from doc_testimony where method like 'kikori:%' and method not like 'kikori:%:%'`)).rows[0].n,
    }
    assert.deepEqual(after, { terms: 0, extra: 0, testimony: 0 })
  })

  it('a doc with only theme elements still ends at extra_terms = []', async () => {
    const { rows } = await db.query<{ id: number }>(`select id from docs where uri = $1`, [docs[5].uri])
    const docId = rows[0].id
    await db.query(`update docs set extra_terms = '[{"term":"wb_678_economy","kind":"theme"}]'::jsonb where id = $1`, [docId])
    await db.query(`insert into doc_terms (doc_id, term, kind) values ($1, 'wb_678_economy', 'theme') on conflict do nothing`, [docId])

    await purgeThemes()

    const { rows: extra } = await db.query<{ extra_terms: unknown[] }>(`select extra_terms from docs where id = $1`, [docId])
    assert.deepEqual(extra[0].extra_terms, [])
  })
})

// Verifier suite for AC7, written independently against a doc the builder's own tests never
// touch (docs[6]), so it exercises purgeThemes' selective-strip behaviour from scratch.
describe('purge themes strips only theme elements, keeps org (issue #209 AC7, verifier)', () => {
  before(seed)
  after(reseed)

  it('removes a theme element and its doc_terms row while leaving a live org element and its doc_terms row intact', async () => {
    const { rows } = await db.query<{ id: number }>(`select id from docs where uri = $1`, [docs[6].uri])
    const docId = rows[0].id

    await db.query(`update docs set extra_terms = '[{"term":"wb_econ","kind":"theme"},{"term":"ministerio","kind":"org"}]'::jsonb where id = $1`, [docId])
    await db.query(`insert into doc_terms (doc_id, term, kind) values ($1, 'wb_econ', 'theme') on conflict do nothing`, [docId])
    await db.query(`insert into doc_terms (doc_id, term, kind) values ($1, 'ministerio', 'org') on conflict do nothing`, [docId])

    await purgeThemes()

    const { rows: extra } = await db.query<{ extra_terms: { term: string; kind: string }[] }>(`select extra_terms from docs where id = $1`, [docId])
    assert.deepEqual(extra[0].extra_terms, [{ term: 'ministerio', kind: 'org' }])

    const { rows: termRows } = await db.query<{ term: string; kind: string }>(`select term, kind from doc_terms where doc_id = $1 and kind in ('theme', 'org') order by kind`, [docId])
    assert.deepEqual(termRows, [{ term: 'ministerio', kind: 'org' }])
  })
})
