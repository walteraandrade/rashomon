import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildGraphAggregates } from '../src/aggregate.js'
import { db } from '../src/db.js'
import { statements } from '../src/graph.js'
import { main } from '../src/materialize.js'
import { pgWarmStore, splitEntry, warmRecortes, type WarmReader, type WarmWriter } from '../src/warmstore.js'
import { persons } from './fixture.js'
import { built, materialized, recordStatements, restore, storedEntries } from './warmstore-helpers.js'
import './close.js'

const ids = persons.map((p) => ({ id: p.id }))
const pathnamesOf = (personId: string) => warmRecortes(ids).filter((r) => r.personId === personId)
const fileText = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')

// A writer that refuses one person's entries and stores everyone else's for real.
const failingFor = (person: string, store: WarmWriter = pgWarmStore): WarmWriter => ({
  put: (r, text) => (r.personId === person ? Promise.reject(new Error(`put refused ${r.pathname}`)) : store.put(r, text)),
})

const quiet = () => undefined

const rows = async () => (await db.query<{ pathname: string; person_id: string }>(`select pathname, person_id from warm_entries order by pathname`)).rows
const everyPathname = () => warmRecortes(ids).map((r) => r.pathname).sort()
const assertOwners = async () => {
  const owner = new Map(warmRecortes(ids).map((r) => [r.pathname, r.personId]))
  const stored = await rows()
  assert.equal(stored.length, owner.size)
  for (const row of stored) assert.equal(row.person_id, owner.get(row.pathname), row.pathname)
}

describe('materialising', () => {
  before(built)
  after(restore)

  it('never runs linksQuery or linksFastQuery: the links come from the build\'s own edges', async () => {
    const texts = await recordStatements(async () => void (await materialized()))
    assert.ok(texts.length > 0)
    assert.equal(texts.filter((t) => t === statements.links || t === statements.linksFast).length, 0)
  })

  it('writes the same pathnames on every run, so the table never grows (AC13)', async () => {
    await materialized()
    const first = await rows()
    assert.equal(await main([], { log: quiet }), 0)
    assert.deepEqual(await rows(), first)
    assert.equal(first.length, warmRecortes(ids).length)
  })

  it('writes each row with its own person\'s id (AC13)', async () => {
    await materialized()
    await assertOwners()
  })
})

describe('a failing run', () => {
  before(built)
  after(restore)

  it('one failing person fails the run, names that person and the error, and every other person\'s rows are stored (AC14)', async () => {
    await db.exec(`delete from warm_entries`)
    const logs: string[] = []
    const code = await main([], { writer: failingFor('lula'), log: (l) => logs.push(l) })
    assert.equal(code, 1)
    const stored = await rows()
    const expected = warmRecortes(ids).filter((r) => r.personId !== 'lula').map((r) => r.pathname).sort()
    assert.equal(expected.length, warmRecortes(ids).length - 6)
    assert.deepEqual(stored.map((r) => r.pathname), expected)
    assert.equal(stored.filter((r) => r.person_id === 'lula').length, 0)
    assert.ok(stored.some((r) => r.person_id === 'tarcisio') && stored.some((r) => r.person_id === 'bolsonaro'))
    assert.ok(logs.some((l) => /lula/.test(l) && /put refused/.test(l)), logs.join('\n'))
  })

  it('with no aggregate build it exits 1, writes nothing and says there are no graph aggregates (AC17)', async () => {
    await db.exec(`delete from warm_entries`)
    await db.exec(`delete from graph_terms`)
    await db.exec(`delete from graph_scopes`)
    try {
      const logs: string[] = []
      assert.equal(await main([], { log: (l) => logs.push(l) }), 1)
      assert.equal((await storedEntries()).size, 0)
      assert.match(logs.join('\n'), /no graph aggregates/i)
    } finally {
      await restore()
    }
  })

  it('an about>0 scope without terms skips only its graph entry; an about=0 scope without terms is written with nodes [] and links [] (AC17)', async () => {
    const { rows: scopes } = await db.query<{ person_id: string; days: number; about: number }>(`select person_id, days, about from graph_scopes where source = 'all'`)
    const aboutOf = (person: string, days: number) => scopes.find((s) => s.person_id === person && s.days === days)!.about
    assert.ok(aboutOf('lula', 7) > 0)
    assert.equal(aboutOf('bolsonaro', 7), 0)
    await db.exec(`delete from graph_terms where person_id = 'lula' and days = 7`)
    try {
      const logs: string[] = []
      const code = await main([], { log: (l) => logs.push(l) })
      assert.equal(code, 0)
      const entries = await storedEntries()
      const lula7 = pathnamesOf('lula').filter((r) => r.days === 7)
      assert.deepEqual([...entries.keys()].filter((p) => lula7.some((r) => r.pathname === p)).sort(), lula7.filter((r) => r.route !== 'graph').map((r) => r.pathname).sort())
      assert.ok(logs.some((l) => /lula 7d/.test(l) && /graph entry skipped/.test(l)))
      assert.equal(entries.size, warmRecortes(ids).length - 1)
      const bolsonaro = pathnamesOf('bolsonaro')
      assert.ok(bolsonaro.every((r) => entries.has(r.pathname)))
      for (const r of bolsonaro.filter((r) => r.route === 'graph')) {
        const body = JSON.parse(splitEntry(entries.get(r.pathname)!)!.body)
        assert.deepEqual([body.nodes, body.links], [[], []], r.path)
      }
    } finally {
      await restore()
    }
  })
})

describe('with nothing configured', () => {
  before(built)
  after(restore)

  it('writes exactly warmRecortes\' pathnames to warm_entries, each row with its own person, exits 0 and never logs "no warm store configured" (AC13)', async () => {
    for (const name of ['BLOB_READ_WRITE_TOKEN', 'WARM_STORE_URL']) delete process.env[name]
    await db.exec(`delete from warm_entries`)
    const logs: string[] = []
    assert.equal(await main([], { log: (l) => logs.push(l) }), 0)
    assert.ok(logs.length > 0)
    assert.ok(logs.every((l) => !/no warm store configured/i.test(l)), logs.join('\n'))
    assert.deepEqual((await rows()).map((r) => r.pathname), everyPathname())
    await assertOwners()
  })
})

describe('--if-stale and --dry-run', () => {
  before(built)
  after(restore)

  const total = warmRecortes(ids).length
  const countingWriter = () => {
    const puts: string[] = []
    const writer: WarmWriter = { put: (r, text) => (puts.push(r.pathname), pgWarmStore.put(r, text)) }
    return { puts, writer }
  }
  const run = (argv: string[], writer: WarmWriter = pgWarmStore, reader?: WarmReader) => main(argv, { writer, reader, log: quiet })

  it('--if-stale checks the stored keys before building anything and rewrites only what changed (AC15)', async () => {
    await db.exec(`delete from warm_entries`)
    const { puts, writer } = countingWriter()

    assert.equal(await run(['--if-stale'], writer), 0)
    assert.equal(puts.length, total, 'an empty table is rewritten whole')

    puts.length = 0
    const before = await rows()
    let code = -1
    const texts = await recordStatements(async () => void (code = await run(['--if-stale'], writer)))
    assert.equal(code, 0)
    assert.equal(puts.length, 0)
    const reads = [
      /^select built_at::text as built_at, about from graph_scopes/,
      /from persons/,
      /^\s*select exists \(select 1 from graph_scopes\)/,
      /^select body from warm_entries where pathname = \$1/,
    ]
    for (const t of texts) {
      assert.ok(reads.some((r) => r.test(t)), `unexpected statement on an up-to-date table: ${t.slice(0, 80)}`)
      assert.doesNotMatch(t, /term_communities|term_links|doc_terms|doc_testimony|\binsert\b|\bupdate\b|\bdelete\b/i)
    }
    assert.ok(texts.every((t) => !/graph_terms/.test(t) || /^\s*select exists/.test(t)))
    assert.ok(texts.some((t) => /warm_entries/.test(t)), 'the stored keys are read')
    assert.ok(texts.some((t) => /\bfrom graph_scopes\b/.test(t)), 'the scopes are read')
    assert.deepEqual(await rows(), before)

    await db.exec(`update graph_scopes set built_at = built_at + interval '1 second' where person_id = 'lula' and days = 7 and source = 'all'`)
    assert.equal(await run(['--if-stale'], writer), 0)
    const window = pathnamesOf('lula').filter((r) => r.days === 7)
    assert.equal(window.length, 3)
    assert.deepEqual(puts.sort(), window.map((r) => r.pathname).sort())
    const { rows: scope } = await db.query<{ built_at: string }>(`select built_at::text as built_at from graph_scopes where person_id = 'lula' and days = 7 and source = 'all'`)
    const stored = await storedEntries()
    for (const r of window) assert.equal(splitEntry(stored.get(r.pathname)!)!.key, scope[0].built_at, r.pathname)

    puts.length = 0
    assert.equal(await run(['--if-stale'], writer), 0)
    assert.deepEqual(puts, [], 'now up to date again')

    await db.exec(`delete from warm_entries`)
    assert.equal(await run(['--if-stale'], writer), 0)
    assert.equal(puts.length, total, 'with the table emptied, everything is rewritten')
  })

  it('--if-stale rewrites every entry once a fresh aggregate build moves every built_at', async () => {
    const { puts, writer } = countingWriter()
    assert.equal(await run(['--if-stale'], writer), 0)
    puts.length = 0
    await buildGraphAggregates(persons)
    assert.equal(await run(['--if-stale'], writer), 0)
    assert.deepEqual(puts.sort(), warmRecortes(ids).map((r) => r.pathname).sort())
  })

  it('--dry-run leaves warm_entries unchanged, also with --if-stale, whatever writer it is given, and logs the entries, the byte total and the largest pathname (AC16)', async () => {
    await db.exec(`delete from warm_entries`)
    assert.equal(await run([]), 0)
    const sizes = [...(await storedEntries())].map(([pathname, body]) => ({ pathname, bytes: Buffer.byteLength(body) }))
    const bytes = sizes.reduce((sum, e) => sum + e.bytes, 0)
    const largest = sizes.reduce((best, e) => (e.bytes > best.bytes ? e : best))
    const never: WarmWriter = { put: () => Promise.reject(new Error('put must not be called')) }

    await db.exec(`delete from warm_entries`)
    for (const argv of [['--dry-run'], ['--dry-run', '--if-stale']]) {
      const logs: string[] = []
      assert.equal(await main(argv, { writer: never, log: (l) => logs.push(l) }), 0, argv.join(' '))
      assert.equal((await storedEntries()).size, 0, `${argv.join(' ')} wrote to warm_entries`)
      const summary = logs.find((l) => /^dry run/.test(l))!
      assert.match(summary, new RegExp(`would write ${total} entries, ${bytes} B, largest ${largest.pathname} \\(${largest.bytes} B\\)`), argv.join(' '))
    }
  })

  it('--dry-run --if-stale reads the real table: 0 entries to write after a full run, one window\'s three when its built_at moved (AC16)', async () => {
    assert.equal(await run([]), 0)
    const before = await storedEntries()
    const dry = async () => {
      const logs: string[] = []
      assert.equal(await main(['--dry-run', '--if-stale'], { log: (l) => logs.push(l) }), 0)
      return logs.find((l) => /^dry run/.test(l))!
    }
    assert.match(await dry(), /would write 0 entries, 0 B, largest none, \d+ windows already up to date, 0 failed/)
    await db.exec(`update graph_scopes set built_at = built_at + interval '1 minute' where person_id = 'lula' and days = 7`)
    assert.match(await dry(), /would write 3 entries/)
    assert.deepEqual(await storedEntries(), before)
  })
})

describe('the workflows', () => {
  const lines = (file: string) => fileText(`.github/workflows/${file}`).split('\n')
  const stepAt = (all: string[], command: RegExp) => {
    const start = all.findIndex((l) => /^\s*- run:/.test(l) && command.test(l))
    assert.notEqual(start, -1, `no step matching ${command}`)
    const indent = all[start].match(/^\s*/)![0].length
    const end = all.findIndex((l, i) => i > start && new RegExp(`^\\s{${indent}}- `).test(l))
    return { start, block: all.slice(start, end === -1 ? undefined : end).join('\n') }
  }

  const cases: [string, RegExp, RegExp, number][] = [
    ['ingest.yml', /pnpm ingest\b/, /pnpm materialize\s*$/, 20],
    ['warm.yml', /pnpm aggregate --if-missing/, /pnpm materialize --if-stale/, 15],
  ]
  for (const [file, collecting, materializing, minutes] of cases) {
    it(`${file} names neither Blob variable, still passes TESTIMONY_REVISION, and runs pnpm materialize after its collecting step and before the cache purge, continue-on-error, ${minutes} minutes (AC19)`, () => {
      const text = fileText(`.github/workflows/${file}`)
      assert.doesNotMatch(text, /BLOB_READ_WRITE_TOKEN/)
      assert.doesNotMatch(text, /WARM_STORE_URL/)
      assert.match(text, /TESTIMONY_REVISION: \$\{\{ vars\.TESTIMONY_REVISION \}\}/)
      assert.doesNotMatch(text, /^\s*TESTIMONY_DTYPE:/m)
      const all = lines(file)
      const materialize = stepAt(all, materializing)
      assert.ok(stepAt(all, collecting).start < materialize.start, 'after the collecting step')
      assert.ok(materialize.start < all.findIndex((l) => /cache dangerously-delete/.test(l)), 'before the cache purge')
      assert.match(materialize.block, /continue-on-error: true/)
      assert.match(materialize.block, new RegExp(`timeout-minutes: ${minutes}\\b`))
    })
  }
})
