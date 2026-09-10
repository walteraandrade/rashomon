import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { poolConfig } from '../src/db.js'
import { docsText } from './docs.js'
import { withEnv } from './env.js'

// Independent verifier pass on issue #110: written from the approved spec's acceptance
// criteria, not from src/db.ts's own test/db.test.ts. poolConfig is pure and synchronous,
// so every case here inspects its return value or its thrown error directly and never
// opens a socket (AC5), matching the spec's own instruction not to construct a pg.Pool
// or a PGlite instance.

const repoFile = (relPath: string) => readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8')

describe('poolConfig (issue #110 verifier)', () => {
  it('AC1: a local host (localhost) gets ssl undefined whether or not PG_SSL_CA is set', async () => {
    await withEnv({ PG_SSL_CA: undefined }, () => {
      assert.equal(poolConfig('postgres://u:p@localhost:5432/db').ssl, undefined)
    })
    await withEnv({ PG_SSL_CA: 'some-ca-pem' }, () => {
      assert.equal(poolConfig('postgres://u:p@localhost:5432/db').ssl, undefined)
    })
  })

  it('AC1: a local host (127.0.0.1) gets ssl undefined whether or not PG_SSL_CA is set', async () => {
    await withEnv({ PG_SSL_CA: undefined }, () => {
      assert.equal(poolConfig('postgres://u:p@127.0.0.1:5432/db').ssl, undefined)
    })
    await withEnv({ PG_SSL_CA: 'some-ca-pem' }, () => {
      assert.equal(poolConfig('postgres://u:p@127.0.0.1:5432/db').ssl, undefined)
    })
  })

  it('AC2: sslmode is stripped from a local connection string', async () => {
    await withEnv({ PG_SSL_CA: undefined }, () => {
      const { connectionString } = poolConfig('postgres://u:p@localhost:5432/db?sslmode=require&x=1')
      assert.doesNotMatch(String(connectionString), /sslmode/)
      assert.match(String(connectionString), /x=1/)
    })
  })

  it('AC2: sslmode is stripped from a non-local connection string', async () => {
    await withEnv({ PG_SSL_CA: 'some-ca-pem' }, () => {
      const { connectionString } = poolConfig('postgres://u:p@db.example.com:5432/db?sslmode=require&x=1')
      assert.doesNotMatch(String(connectionString), /sslmode/)
      assert.match(String(connectionString), /x=1/)
    })
  })

  it('AC3: a non-local host with PG_SSL_CA set returns rejectUnauthorized true and the CA verbatim', async () => {
    const ca = '-----BEGIN CERTIFICATE-----\r\nline one\nline two\n-----END CERTIFICATE-----\n'
    await withEnv({ PG_SSL_CA: ca }, () => {
      const { ssl } = poolConfig('postgres://u:p@db.example.com:5432/db')
      assert.ok(ssl && typeof ssl === 'object')
      const s = ssl as { rejectUnauthorized?: boolean; ca?: unknown }
      assert.equal(s.rejectUnauthorized, true)
      // no trim, no base64 decode, no newline substitution: the value is used exactly as read
      assert.equal(s.ca, ca)
    })
  })

  it('AC4: a non-local host with PG_SSL_CA unset throws synchronously naming PG_SSL_CA', async () => {
    await withEnv({ PG_SSL_CA: undefined }, () => {
      assert.throws(() => poolConfig('postgres://u:p@db.example.com:5432/db'), (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /PG_SSL_CA/)
        return true
      })
    })
  })

  it('AC4: a non-local host with PG_SSL_CA set to an empty string also throws naming PG_SSL_CA', async () => {
    await withEnv({ PG_SSL_CA: '' }, () => {
      assert.throws(() => poolConfig('postgres://u:p@db.example.com:5432/db'), /PG_SSL_CA/)
    })
  })

  it('AC6: db.ts imports cleanly with DATA_DIR=memory:// and no DATABASE_URL/POSTGRES_URL set', () => {
    // This module (and every other test file) already imported src/db.ts under exactly this
    // environment before this test body ran; a throw during that import would have aborted
    // the whole node:test run rather than reach this assertion. That import path never calls
    // remote()/poolConfig() because url is undefined (src/db.ts: `url ? remote(url) : embedded(...)`).
    assert.equal(process.env.DATABASE_URL, undefined)
    assert.equal(process.env.POSTGRES_URL, undefined)
    assert.equal(typeof poolConfig, 'function')
  })

  it('AC7: src/push.ts constructs its pool with no independent ssl key of its own', () => {
    const src = repoFile('src/push.ts')
    const poolCall = /new pg\.Pool\(\{([^;]*?)\}\)/.exec(src)
    assert.ok(poolCall, 'expected src/push.ts to construct a pg.Pool')
    assert.doesNotMatch(poolCall[1], /\bssl\s*:/)
    assert.match(poolCall[1], /poolConfig\(url\)/)
  })

  it('AC8: docs state, as a fact, that a non-local connection requires a PEM CA via PG_SSL_CA and fails closed without it', () => {
    assert.match(docsText, /PG_SSL_CA/)
    assert.match(docsText, /CA certificate/i)
    assert.match(docsText, /PEM/)
    assert.match(docsText, /(fails? closed|refuses to (build|connect)|stops the connection)/i)
    assert.doesNotMatch(docsText, /PG_SSL_INSECURE/)
  })

  it('AC9: docs state PG_SSL_CA must be set in Vercel before a deploy, next to DATABASE_URL/POSTGRES_URL', () => {
    assert.match(docsText, /PG_SSL_CA[\s\S]{0,500}Vercel|Vercel[\s\S]{0,500}PG_SSL_CA/)
    assert.match(docsText, /PG_SSL_CA[\s\S]{0,300}(DATABASE_URL|POSTGRES_URL)|(DATABASE_URL|POSTGRES_URL)[\s\S]{0,300}PG_SSL_CA/)
  })

  it('AC10: the ingest workflow passes PG_SSL_CA from a repository secret alongside DATABASE_URL', () => {
    const workflow = repoFile('.github/workflows/ingest.yml')
    assert.match(workflow, /DATABASE_URL:\s*\$\{\{\s*secrets\.DATABASE_URL\s*\}\}/)
    assert.match(workflow, /PG_SSL_CA:\s*\$\{\{\s*secrets\.PG_SSL_CA\s*\}\}/)
  })

  it('AC12: the comment above poolConfig no longer claims the connection is unverified', () => {
    const src = repoFile('src/db.ts')
    const [, comment] = /((?:\/\/[^\n]*\n)+)export const poolConfig/.exec(src) ?? []
    assert.ok(comment, 'expected a leading comment block directly above poolConfig')
    assert.doesNotMatch(comment, /without chain verification/i)
    assert.doesNotMatch(comment, /encrypted,? without/i)
    assert.match(comment, /PG_SSL_CA/)
    assert.match(comment, /verif(y|ied|ication)/i)
  })

  it('out of scope: no PG_SSL_INSECURE opt-out exists anywhere in src/db.ts', () => {
    const src = repoFile('src/db.ts')
    assert.doesNotMatch(src, /PG_SSL_INSECURE/)
  })
})
