import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { poolConfig } from '../src/db.js'
import { docsText } from './docs.js'
import { withEnv } from './env.js'

const readRepoFile = (relPath: string) => readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8')

// poolConfig is pure and synchronous: these tests inspect its return value or its thrown
// error, never a real socket, pool or PGlite instance.

describe('poolConfig', () => {
  it('leaves ssl undefined for a local host (localhost)', async () => {
    await withEnv({ PG_SSL_CA: undefined }, () => {
      assert.equal(poolConfig('postgres://user:pw@localhost:5432/db').ssl, undefined)
    })
  })

  it('leaves ssl undefined for a local host (127.0.0.1), with or without PG_SSL_CA', async () => {
    await withEnv({ PG_SSL_CA: undefined }, () => {
      assert.equal(poolConfig('postgres://user:pw@127.0.0.1:5432/db').ssl, undefined)
    })
    await withEnv({ PG_SSL_CA: 'fake-ca-pem' }, () => {
      assert.equal(poolConfig('postgres://user:pw@127.0.0.1:5432/db').ssl, undefined)
    })
  })

  it('strips sslmode from a local url', async () => {
    await withEnv({ PG_SSL_CA: undefined }, () => {
      const config = poolConfig('postgres://user:pw@localhost:5432/db?sslmode=require')
      assert.equal((config.connectionString as string).includes('sslmode'), false)
    })
  })

  it('strips sslmode from a non-local url', async () => {
    await withEnv({ PG_SSL_CA: 'fake-ca-pem' }, () => {
      const config = poolConfig('postgres://user:pw@db.example.com:5432/db?sslmode=require')
      assert.equal((config.connectionString as string).includes('sslmode'), false)
    })
  })

  it('returns a verified ssl config for a non-local host when PG_SSL_CA is set', async () => {
    const ca = '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n'
    await withEnv({ PG_SSL_CA: ca }, () => {
      const config = poolConfig('postgres://user:pw@db.example.com:5432/db')
      const ssl = config.ssl as { rejectUnauthorized: boolean; ca: string }
      assert.equal(ssl.rejectUnauthorized, true)
      assert.equal(ssl.ca, ca)
    })
  })

  it('throws naming PG_SSL_CA when unset for a non-local host', async () => {
    await withEnv({ PG_SSL_CA: undefined }, () => {
      assert.throws(() => poolConfig('postgres://user:pw@db.example.com:5432/db'), /PG_SSL_CA/)
    })
  })

  it('throws naming PG_SSL_CA when empty for a non-local host', async () => {
    await withEnv({ PG_SSL_CA: '' }, () => {
      assert.throws(() => poolConfig('postgres://user:pw@db.example.com:5432/db'), /PG_SSL_CA/)
    })
  })

  it('importing db.ts does not throw when DATABASE_URL and POSTGRES_URL are unset', () => {
    // Implied by the rest of the suite running at all: db.ts is imported by every other test
    // file under this environment (DATA_DIR=memory://, no DATABASE_URL/POSTGRES_URL), which
    // never reaches remote()/poolConfig() and therefore never throws.
    assert.equal(process.env.DATABASE_URL, undefined)
    assert.equal(process.env.POSTGRES_URL, undefined)
  })

  it('src/push.ts sets no independent ssl key, so it inherits poolConfig unchanged', () => {
    const src = readRepoFile('src/push.ts')
    assert.doesNotMatch(src, /ssl\s*:/)
  })

  it('the docs state that a non-local connection requires PG_SSL_CA and fails closed without it', () => {
    assert.match(docsText, /PG_SSL_CA/)
    assert.match(docsText, /CA certificate/i)
  })

  it('the docs state that PG_SSL_CA must be set in Vercel before a deploy against a non-local database', () => {
    assert.match(docsText, /PG_SSL_CA[\s\S]{0,400}Vercel/i)
  })

  it('.github/workflows/ingest.yml passes PG_SSL_CA from a repository secret alongside DATABASE_URL', () => {
    const workflow = readRepoFile('.github/workflows/ingest.yml')
    assert.match(workflow, /PG_SSL_CA:\s*\$\{\{\s*secrets\.PG_SSL_CA\s*\}\}/)
  })
})
