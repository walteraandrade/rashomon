import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { db } from '../src/db.js'
import { collectSizes, SIZE_TABLES } from '../src/size.js'
import { docsText } from './docs.js'
import { seed } from './fixture.js'
import './close.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const { DATABASE_URL: _url, POSTGRES_URL: _pg, ...localEnv } = process.env
const childEnv = (dataDir: string) => ({ ...localEnv, DATA_DIR: dataDir })

const readRepoFile = (relPath: string) => readFileSync(join(repoRoot, relPath), 'utf8')

// Spec for pnpm size (issue 205): a read-only report of every maintained table's on-disk
// size plus the database total, wired after pnpm ingest in CI.
describe('pnpm size', () => {
  // spec criterion: exits 0 against a migrated database and prints one trailing JSON line
  // whose tables key has exactly the eleven SIZE_TABLES names, each >= 0, plus a total >= 0.
  it('exits 0 against a freshly migrated on-disk database and prints a trailing JSON line with every table and a total', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'rashomon-size-'))
    try {
      const env = childEnv(dataDir)
      const migrate = spawnSync(process.execPath, ['--import', 'tsx', 'src/migrate.ts'], {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
      })
      assert.equal(migrate.status, 0, migrate.stderr)

      const size = spawnSync(process.execPath, ['--import', 'tsx', 'src/size.ts'], {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
      })
      assert.equal(size.status, 0, size.stderr)

      const lines = size.stdout.trim().split('\n')
      const report = JSON.parse(lines[lines.length - 1]) as { tables: Record<string, number>; total: number }
      assert.deepEqual(new Set(Object.keys(report.tables)), new Set(SIZE_TABLES))
      for (const v of Object.values(report.tables)) {
        assert.equal(typeof v, 'number')
        assert.ok(v >= 0)
      }
      assert.equal(typeof report.total, 'number')
      assert.ok(report.total >= 0)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  describe('collectSizes', () => {
    // spec criterion: the size-collecting function takes its query function as a parameter
    // and issues only select statements, never a migration, analyze or write.
    it('takes its query function as a parameter and issues only select statements', async () => {
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

    // spec criterion: reports every table in SIZE_TABLES with a non-negative size and a
    // non-negative total, against the fixture-seeded database, never an exact byte count.
    it('reports every SIZE_TABLES name with a non-negative size and a non-negative total', async () => {
      await seed()
      const { tables, total } = await collectSizes(db.query.bind(db))
      assert.deepEqual(new Set(Object.keys(tables)), new Set(SIZE_TABLES))
      for (const size of Object.values(tables)) {
        assert.equal(typeof size, 'number')
        assert.ok(size >= 0)
      }
      assert.equal(typeof total, 'number')
      assert.ok(total >= 0)
    })

    it('SIZE_TABLES has exactly the eleven documented table names', () => {
      assert.deepEqual(
        [...SIZE_TABLES].sort(),
        [
          'doc_candidates',
          'doc_persons',
          'doc_terms',
          'doc_testimony',
          'docs',
          'gkg_files',
          'graph_scopes',
          'graph_terms',
          'persons',
          'phrase_stage',
          'phrases',
        ].sort(),
      )
    })
  })

  // spec criterion: on a query failure, main() sets process.exitCode = 1 (never
  // process.exit()) and does not print a partial JSON line.
  it('on a query failure against an unmigrated database, exits with status 1 and prints no JSON line', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'rashomon-size-unmigrated-'))
    try {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/size.ts'], {
        cwd: repoRoot,
        env: childEnv(dataDir),
        encoding: 'utf8',
      })
      assert.equal(result.status, 1)
      const lines = result.stdout.trim().split('\n').filter(Boolean)
      const last = lines[lines.length - 1]
      assert.throws(() => JSON.parse(last ?? ''))
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  // spec criterion: .github/workflows/ingest.yml runs pnpm size after pnpm ingest, pipes its
  // output to $GITHUB_STEP_SUMMARY and tolerates a failure there without failing the job (so
  // a transient size-step error never skips the cache purge/warm steps below it).
  describe('.github/workflows/ingest.yml', () => {
    it('runs pnpm size after pnpm ingest and pipes its output to the step summary', () => {
      const workflow = readRepoFile('.github/workflows/ingest.yml')
      const ingestIdx = workflow.indexOf('- run: pnpm ingest')
      const sizeIdx = workflow.indexOf('pnpm -s size')
      assert.ok(ingestIdx > -1)
      assert.ok(sizeIdx > ingestIdx)
      assert.match(workflow, /pnpm -s size[^\n]*GITHUB_STEP_SUMMARY/)
    })

    it('does not fail the job when pnpm size fails', () => {
      const workflow = readRepoFile('.github/workflows/ingest.yml')
      const sizeIdx = workflow.indexOf('pnpm -s size')
      const nextStepIdx = workflow.indexOf('- run:', sizeIdx)
      const stepSlice = workflow.slice(sizeIdx, nextStepIdx > -1 ? nextStepIdx : undefined)
      assert.match(stepSlice, /continue-on-error:\s*true/)
    })
  })

  // spec criterion: docs/operations.md documents that pnpm size exists, reports
  // pg_total_relation_size per table and pg_database_size for the total, and is read-only.
  describe('docs', () => {
    it('documents pnpm size as read-only, reporting pg_total_relation_size and pg_database_size', () => {
      assert.match(docsText, /pnpm size/)
      assert.match(docsText, /pg_total_relation_size/)
      assert.match(docsText, /pg_database_size/)
      assert.match(docsText, /read-only/)
    })
  })
})
