import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import tls from 'node:tls'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { poolConfig } from '../src/db.js'
import { docsText } from './docs.js'
import { withEnv } from './env.js'

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
