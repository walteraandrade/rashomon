import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { db } from '../src/db.js'
import { collectSizes, SIZE_TABLES } from '../src/size.js'
import { docsText } from './docs.js'
import { seed } from './fixture.js'
import './close.js'

const readRepoFile = (relPath: string) => readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8')

describe('collectSizes', () => {
  it('reports every table in SIZE_TABLES with a non-negative size', async () => {
    await seed()
    const { tables } = await collectSizes(db.query.bind(db))
    assert.deepEqual(new Set(Object.keys(tables)), new Set(SIZE_TABLES))
    for (const size of Object.values(tables)) {
      assert.equal(typeof size, 'number')
      assert.ok(size >= 0)
    }
  })

  it('total is a non-negative number', async () => {
    await seed()
    const { total } = await collectSizes(db.query.bind(db))
    assert.equal(typeof total, 'number')
    assert.ok(total >= 0)
  })

  it('never issues a non-select statement', async () => {
    await seed()
    const statements: string[] = []
    const recording = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      statements.push(sql)
      return db.query<T>(sql, params)
    }
    await collectSizes(recording)
    assert.ok(statements.length > 0)
    for (const s of statements) assert.match(s.trim().toLowerCase(), /^select/)
  })
})

describe('.github/workflows/ingest.yml', () => {
  it('runs pnpm size after pnpm ingest and pipes its output to the step summary', () => {
    const workflow = readRepoFile('.github/workflows/ingest.yml')
    const ingestIdx = workflow.indexOf('pnpm ingest')
    const sizeIdx = workflow.indexOf('pnpm size')
    assert.ok(ingestIdx > -1)
    assert.ok(sizeIdx > ingestIdx)
    assert.match(workflow, /pnpm size[^\n]*GITHUB_STEP_SUMMARY/)
  })
})

describe('docs', () => {
  it('documents pnpm size as read-only, reporting pg_total_relation_size and pg_database_size', () => {
    assert.match(docsText, /pnpm size/)
    assert.match(docsText, /pg_total_relation_size/)
    assert.match(docsText, /pg_database_size/)
    assert.match(docsText, /read-only/)
  })
})
