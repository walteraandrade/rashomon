import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import tls from 'node:tls'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ANALYZED_TABLES, analyzeAfterWrite, analyzeMinDocs, analyzeTables, db, migrate, poolConfig } from '../src/db.js'
import { docsText } from './docs.js'
import { withEnv } from './env.js'
import { indexDefs, lastAnalyzed, planRowEstimate, seed } from './fixture.js'
import './close.js'

// src/db.ts: the connection (poolConfig, pure and never opening a socket), the schema migrate()
// produces, and the analyze maintenance policy.

const readRepoFile = (relPath: string) => readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8')

// poolConfig is pure and synchronous: every test here inspects its return value or its
// thrown error and never constructs a pg.Pool or a PGlite instance, so none of them opens
// a real socket (AC5).

describe('poolConfig', () => {
  it('AC1: returns ssl undefined for a local host (localhost), with or without PG_SSL_CA', async () => {
    await withEnv({ PG_SSL_CA: undefined }, () => {
      assert.equal(poolConfig('postgres://user:pw@localhost:5432/db').ssl, undefined)
    })
    await withEnv({ PG_SSL_CA: 'fake-ca-pem' }, () => {
      assert.equal(poolConfig('postgres://user:pw@localhost:5432/db').ssl, undefined)
    })
  })

  it('AC1: returns ssl undefined for a local host (127.0.0.1), with or without PG_SSL_CA', async () => {
    await withEnv({ PG_SSL_CA: undefined }, () => {
      assert.equal(poolConfig('postgres://user:pw@127.0.0.1:5432/db').ssl, undefined)
    })
    await withEnv({ PG_SSL_CA: 'fake-ca-pem' }, () => {
      assert.equal(poolConfig('postgres://user:pw@127.0.0.1:5432/db').ssl, undefined)
    })
  })

  it('AC2: strips sslmode from a local url, keeping other params', async () => {
    await withEnv({ PG_SSL_CA: undefined }, () => {
      const { connectionString } = poolConfig('postgres://user:pw@localhost:5432/db?sslmode=require&x=1')
      assert.doesNotMatch(String(connectionString), /sslmode/)
      assert.match(String(connectionString), /x=1/)
    })
  })

  it('AC2: strips sslmode from a non-local url, keeping other params', async () => {
    await withEnv({ PG_SSL_CA: 'fake-ca-pem' }, () => {
      const { connectionString } = poolConfig('postgres://user:pw@db.example.com:5432/db?sslmode=require&x=1')
      assert.doesNotMatch(String(connectionString), /sslmode/)
      assert.match(String(connectionString), /x=1/)
    })
  })

  it('AC3: returns a verified ssl config for a non-local host when PG_SSL_CA is set, using the value verbatim', async () => {
    const ca = '-----BEGIN CERTIFICATE-----\r\nfake\nmulti\nline\n-----END CERTIFICATE-----\n'
    await withEnv({ PG_SSL_CA: ca }, () => {
      const config = poolConfig('postgres://user:pw@db.example.com:5432/db')
      const ssl = config.ssl as { rejectUnauthorized: boolean; ca: string[] }
      assert.equal(ssl.rejectUnauthorized, true)
      // no trim, no base64 decode, no newline substitution: the value is present exactly as read
      assert.ok(Array.isArray(ssl.ca))
      assert.ok(ssl.ca.includes(ca))
    })
  })

  it('the ssl config adds PG_SSL_CA to Node\'s default trust store rather than replacing it, so a pooler serving a publicly-signed cert still verifies', async () => {
    const ca = 'fake-ca-pem'
    await withEnv({ PG_SSL_CA: ca }, () => {
      const config = poolConfig('postgres://user:pw@db.example.com:5432/db')
      const ssl = config.ssl as { rejectUnauthorized: boolean; ca: string[] }
      assert.equal(ssl.rejectUnauthorized, true)
      assert.ok(ssl.ca.includes(ca))
      assert.ok(tls.rootCertificates.every((root) => ssl.ca.includes(root)))
      assert.equal(ssl.ca.length, tls.rootCertificates.length + 1)
    })
  })

  it('AC4: throws synchronously naming PG_SSL_CA when unset for a non-local host', async () => {
    await withEnv({ PG_SSL_CA: undefined }, () => {
      assert.throws(() => poolConfig('postgres://user:pw@db.example.com:5432/db'), (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /PG_SSL_CA/)
        return true
      })
    })
  })

  it('AC4: throws synchronously naming PG_SSL_CA when empty for a non-local host', async () => {
    await withEnv({ PG_SSL_CA: '' }, () => {
      assert.throws(() => poolConfig('postgres://user:pw@db.example.com:5432/db'), /PG_SSL_CA/)
    })
  })

  it('PG_POOL_MAX: unset, abc, 0 and 500 give 3, 3, 1 and 20', async () => {
    const url = 'postgres://user:pw@localhost:5432/db'
    const cases: [string | undefined, number][] = [[undefined, 3], ['abc', 3], ['0', 1], ['500', 20]]
    await cases.reduce<Promise<void>>(
      (acc, [value, expected]) =>
        acc.then(() => withEnv({ PG_POOL_MAX: value }, () => assert.equal(poolConfig(url).max, expected))),
      Promise.resolve(),
    )
  })

  it('AC6: importing db.ts does not throw when DATABASE_URL and POSTGRES_URL are unset', () => {
    // This test file already imports src/db.ts above, under the test environment's
    // DATA_DIR=memory:// with no DATABASE_URL/POSTGRES_URL. That import already happened
    // without throwing (or the whole suite would already have failed to start), regardless
    // of whether PG_SSL_CA happens to be set, because url ? remote(url) : embedded(...)
    // never reaches remote()/poolConfig() when both are unset.
    assert.equal(process.env.DATABASE_URL, undefined)
    assert.equal(process.env.POSTGRES_URL, undefined)
    assert.equal(typeof poolConfig, 'function')
  })

  it('AC7: src/push.ts sets no independent ssl key, so it inherits poolConfig unchanged', () => {
    const src = readRepoFile('src/push.ts')
    const poolCall = /new pg\.Pool\(\{([^;]*?)\}\)/.exec(src)
    assert.ok(poolCall, 'expected src/push.ts to construct a pg.Pool')
    assert.doesNotMatch(poolCall[1], /\bssl\s*:/)
    assert.match(poolCall[1], /poolConfig\(url\)/)
  })

  it('AC8: the docs state that a non-local connection requires PG_SSL_CA, a PEM CA certificate, and fails closed without it', () => {
    assert.match(docsText, /PG_SSL_CA/)
    assert.match(docsText, /CA certificate/i)
    assert.match(docsText, /PEM/i)
    assert.match(docsText, /fail(s)? closed|refuses to (build|connect)|stops the connection|without an? unverified/i)
    assert.doesNotMatch(docsText, /PG_SSL_INSECURE/)
  })

  it('AC9: the docs state PG_SSL_CA must be set in Vercel before a deploy against a non-local database, alongside DATABASE_URL/POSTGRES_URL', () => {
    assert.match(docsText, /PG_SSL_CA[\s\S]{0,400}Vercel/i)
    assert.match(docsText, /PG_SSL_CA[\s\S]{0,200}(DATABASE_URL|POSTGRES_URL)|(DATABASE_URL|POSTGRES_URL)[\s\S]{0,200}PG_SSL_CA/)
  })

  it('AC10: .github/workflows/ingest.yml passes PG_SSL_CA from a repository secret alongside DATABASE_URL', () => {
    const workflow = readRepoFile('.github/workflows/ingest.yml')
    assert.match(workflow, /DATABASE_URL:\s*\$\{\{\s*secrets\.DATABASE_URL\s*\}\}/)
    assert.match(workflow, /PG_SSL_CA:\s*\$\{\{\s*secrets\.PG_SSL_CA\s*\}\}/)
  })

  it('AC12: the comment above poolConfig describes CA verification, not an unverified connection', () => {
    const src = readRepoFile('src/db.ts')
    const [, comment] = /((?:\/\/[^\n]*\n)+)export const poolConfig/.exec(src) ?? []
    assert.ok(comment, 'expected a comment block directly above poolConfig')
    assert.doesNotMatch(comment, /without chain verification/i)
    assert.doesNotMatch(comment, /encrypted,? without/i)
    assert.match(comment, /PG_SSL_CA/)
    assert.match(comment, /verif/i)
  })

  it('out of scope: no PG_SSL_INSECURE opt-out exists anywhere in src/db.ts', () => {
    const src = readRepoFile('src/db.ts')
    assert.doesNotMatch(src, /PG_SSL_INSECURE/)
  })
})

describe('read indexes and planner statistics (issue #44)', () => {
  before(seed)

  it('indexes doc_persons by person_id first, the column every route filters on', async () => {
    const defs = await indexDefs('doc_persons')
    assert.ok(
      defs.some((d) => d.indexname === 'doc_persons_person_idx' && /btree \(person_id, doc_id\)/.test(d.indexdef)),
      `expected doc_persons_person_idx, got ${JSON.stringify(defs)}`,
    )
  })

  it('keeps schema setup idempotent: a second migrate leaves one index of each name', async () => {
    await migrate()
    await migrate()
    const names = (await indexDefs('doc_persons')).map((d) => d.indexname).sort()
    assert.deepEqual(names, ['doc_persons_person_idx', 'doc_persons_pkey'])
  })

  it('issue #21 AC1: doc_testimony has exactly doc_id/person_id/method/score, that primary key and the person/method index', async () => {
    const cols = (
      await db.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns where table_name = 'doc_testimony'`,
      )
    ).rows
    assert.deepEqual(cols.map((c) => c.column_name).sort(), ['doc_id', 'method', 'person_id', 'score'])
    assert.equal(cols.find((c) => c.column_name === 'method')!.is_nullable, 'NO', 'method is not null')
    assert.equal(cols.find((c) => c.column_name === 'score')!.is_nullable, 'YES', 'score is nullable on purpose')
    const pk = (
      await db.query<{ column_name: string }>(
        `select kcu.column_name from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
         where tc.table_name = 'doc_testimony' and tc.constraint_type = 'PRIMARY KEY'
         order by kcu.ordinal_position`,
      )
    ).rows.map((r) => r.column_name)
    assert.deepEqual(pk, ['doc_id', 'person_id', 'method'])
    const indexes = (await indexDefs('doc_testimony')).map((d) => d.indexname)
    assert.ok(indexes.includes('doc_testimony_person_idx'), 'person/method index exists')
  })

  it('adds no redundant index on docs: the rejected candidates are not in the schema', async () => {
    const defs = (await indexDefs('docs')).map((d) => d.indexdef)
    assert.deepEqual(
      defs.filter((d) => /\(source, published_at\)|\(domain, published_at\)|published_at DESC/i.test(d)),
      [],
    )
    // The two docs indexes measured as sufficient stay exactly as they were.
    assert.ok(defs.some((d) => /btree \(published_at\)/.test(d)))
    assert.ok(defs.some((d) => /btree \(domain\)/.test(d)))
  })

  // The fixture is far too small for the planner to prefer an index on its own, so this
  // asserts the access path exists and covers (person_id, doc_id) -- the shape every
  // person-scoped route needs -- not that the planner picks it at this row count. The
  // timings that justify the index are in docs/perf-baseline.md, on the benchmark corpus.
  it('offers the person scope an index-only path over (person_id, doc_id)', async () => {
    await db.exec(`analyze doc_persons`)
    // vacuum sets the visibility map, without which even a covering index still visits the heap.
    await db.exec(`vacuum doc_persons`)
    await db.exec(`set enable_seqscan = off`)
    const { rows } = await db.query<Record<string, string>>(
      `explain select dp.doc_id from doc_persons dp where dp.person_id = $1`,
      ['lula'],
    )
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n')
    await db.exec(`reset enable_seqscan`)
    assert.match(plan, /Index Only Scan using doc_persons_person_idx/)
    assert.match(plan, /Index Cond: \(person_id = /)
  })
})

describe('analyze maintenance policy (issue #44)', () => {
  before(seed)

  it('refreshes the planner row estimate of every table it targets', async () => {
    // A table that was written but never analyzed carries reltuples = -1: "no estimate yet".
    const before = await Promise.all(ANALYZED_TABLES.map(planRowEstimate))
    assert.ok(before.some((n) => n < 0), 'sanity: the fixture must not analyze on its own')
    const analyzed = await analyzeTables()
    assert.deepEqual([...analyzed], [...ANALYZED_TABLES])
    for (const t of ANALYZED_TABLES) {
      assert.ok((await planRowEstimate(t)) >= 0, `${t} still has no row estimate`)
      assert.ok((await lastAnalyzed(t)) !== null, `${t} was never analyzed`)
    }
  })

  it('analyzes only the tables asked for', async () => {
    const analyzed = await analyzeTables(['doc_persons'])
    assert.deepEqual([...analyzed], ['doc_persons'])
  })

  it('ignores a table name outside the allow list, since a table name cannot be a parameter', async () => {
    const analyzed = await analyzeTables(['persons; drop table docs' as never])
    assert.deepEqual([...analyzed], [])
    assert.ok((await db.query<{ n: number }>(`select count(*)::int as n from docs`)).rows[0].n > 0)
  })

  it('skips the refresh under the threshold and runs it at or above', async () => {
    assert.deepEqual([...(await analyzeAfterWrite(0))], [])
    assert.deepEqual([...(await analyzeAfterWrite(analyzeMinDocs() - 1))], [])
    assert.deepEqual([...(await analyzeAfterWrite(analyzeMinDocs()))], [...ANALYZED_TABLES])
  })
})

describe('ANALYZE_MIN_DOCS clamping (issue #44)', () => {
  const original = process.env.ANALYZE_MIN_DOCS
  after(() => {
    if (original === undefined) delete process.env.ANALYZE_MIN_DOCS
    else process.env.ANALYZE_MIN_DOCS = original
  })

  const withEnv = (v: string | undefined) => {
    if (v === undefined) delete process.env.ANALYZE_MIN_DOCS
    else process.env.ANALYZE_MIN_DOCS = v
    return analyzeMinDocs()
  }

  it('defaults to 200 and falls back to it on garbage', () => {
    assert.equal(withEnv(undefined), 200)
    assert.equal(withEnv('nao-e-numero'), 200)
    assert.equal(withEnv(''), 200)
  })

  it('clamps to the floor and the ceiling', () => {
    assert.equal(withEnv('0'), 1)
    assert.equal(withEnv('-5000'), 1)
    assert.equal(withEnv('99999999'), 1_000_000)
    assert.equal(withEnv('750'), 750)
  })
})

describe('maintenance stays out of the request path (issue #44)', () => {
  const root = new URL('../src/', import.meta.url).pathname
  const owners = ['db.ts', 'ingest.ts', 'reindex.ts', 'bench.ts']

  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
    )

  it('no module outside ingest/reindex/bench runs analyze', () => {
    const offenders = sources(root)
      .filter((f) => !owners.includes(f.slice(root.length)))
      .filter((f) => /analyzeTables|analyzeAfterWrite|`\s*analyze\b/i.test(readFileSync(f, 'utf8')))
    assert.deepEqual(offenders, [], 'maintenance must run only in the process that owns DATA_DIR')
  })
})
