import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildGraphAggregates, hasGraphAggregates } from '../src/aggregate.js'
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

describe('materialising', () => {
  before(built)
  after(restore)

  it('never runs linksQuery or linksFastQuery: the links come from the build\'s own edges', async () => {
    const texts = await recordStatements(async () => void (await materialized()))
    assert.ok(texts.length > 0)
    assert.equal(texts.filter((t) => t === statements.links || t === statements.linksFast).length, 0)
  })

  it('writes the same pathnames on every run, so the table never grows', async () => {
    await materialized()
    const first = await storedEntries()
    assert.equal(await main([], { log: quiet }), 0)
    const second = await storedEntries()
    assert.deepEqual([...first.keys()].sort(), [...second.keys()].sort())
    assert.equal(second.size, warmRecortes(ids).length)
  })

  it('writes each row with its own person\'s id', async () => {
    await materialized()
    const { rows } = await db.query<{ pathname: string; person_id: string }>(`select pathname, person_id from warm_entries`)
    const owner = new Map(warmRecortes(ids).map((r) => [r.pathname, r.personId]))
    assert.equal(rows.length, owner.size)
    for (const row of rows) assert.equal(row.person_id, owner.get(row.pathname))
  })
})

describe('a failing run', () => {
  before(built)
  after(restore)

  it('one failing person does not stop the others, and the run reports it', async () => {
    await db.exec(`delete from warm_entries`)
    const logs: string[] = []
    const code = await main([], { writer: failingFor('lula'), log: (l) => logs.push(l) })
    assert.equal(code, 1)
    const stored = [...(await storedEntries()).keys()]
    assert.equal(stored.length, warmRecortes(ids).length - 6)
    assert.ok(stored.every((p) => !p.startsWith('warm/v1/lula/')))
    assert.ok(stored.some((p) => p.startsWith('warm/v1/tarcisio/')) && stored.some((p) => p.startsWith('warm/v1/bolsonaro/')))
    assert.ok(logs.some((l) => /lula/.test(l) && /put refused/.test(l)))
  })

  it('with no aggregate build it writes nothing and says why', async () => {
    await db.exec(`delete from warm_entries`)
    await db.exec(`delete from graph_terms`)
    await db.exec(`delete from graph_scopes`)
    try {
      const logs: string[] = []
      assert.equal(await main([], { log: (l) => logs.push(l) }), 1)
      assert.equal((await storedEntries()).size, 0)
      assert.match(logs.join('\n'), /no graph aggregates/)
    } finally {
      await restore()
    }
  })

  it('an about>0 scope without terms skips only its graph entry; an about=0 scope without terms is written', async () => {
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
      const graph = bolsonaro.find((r) => r.route === 'graph' && r.days === 7)!
      const body = JSON.parse(splitEntry(entries.get(graph.pathname)!)!.body)
      assert.deepEqual([body.nodes, body.links], [[], []])
    } finally {
      await restore()
    }
  })
})

describe('with nothing configured', () => {
  before(built)
  after(restore)

  it('writes to warm_entries, exits 0 and never logs "no warm store configured"', async () => {
    for (const name of ['BLOB_READ_WRITE_TOKEN', 'WARM_STORE_URL']) delete process.env[name]
    const logs: string[] = []
    assert.equal(await main([], { log: (l) => logs.push(l) }), 0)
    assert.ok(logs.every((l) => !/no warm store configured/.test(l)))
    assert.deepEqual([...(await storedEntries()).keys()].sort(), warmRecortes(ids).map((r) => r.pathname).sort())
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

  it('checks the stored keys before building anything and rewrites only what changed', async () => {
    await db.exec(`delete from warm_entries`)
    const { puts, writer } = countingWriter()

    assert.equal(await run(['--if-stale'], writer), 0)
    assert.equal(puts.length, total, 'an empty table is rewritten whole')

    puts.length = 0
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
    for (const t of texts) assert.ok(reads.some((r) => r.test(t)), `unexpected statement on an up-to-date table: ${t.slice(0, 80)}`)
    assert.ok(texts.every((t) => !/graph_terms/.test(t) || /^\s*select exists/.test(t)))
    assert.ok(texts.some((t) => /warm_entries/.test(t)), 'the stored keys are read')

    await db.exec(`update graph_scopes set built_at = built_at + interval '1 second' where person_id = 'lula' and days = 7 and source = 'all'`)
    assert.equal(await run(['--if-stale'], writer), 0)
    assert.deepEqual(puts.sort(), pathnamesOf('lula').filter((r) => r.days === 7).map((r) => r.pathname).sort())

    puts.length = 0
    await db.exec(`delete from warm_entries`)
    assert.equal(await run(['--if-stale'], writer), 0)
    assert.equal(puts.length, total, 'with the table emptied, everything is rewritten')
  })

  it('rewrites every entry once a fresh aggregate build moves every built_at', async () => {
    const { puts, writer } = countingWriter()
    assert.equal(await run(['--if-stale'], writer), 0)
    puts.length = 0
    await buildGraphAggregates(persons)
    assert.equal(await run(['--if-stale'], writer), 0)
    assert.deepEqual(puts.sort(), warmRecortes(ids).map((r) => r.pathname).sort())
  })

  it('--dry-run writes nothing to warm_entries, also with --if-stale, and reports size', async () => {
    await db.exec(`delete from warm_entries`)
    const never: WarmWriter = { put: () => Promise.reject(new Error('put must not be called')) }
    for (const argv of [['--dry-run'], ['--dry-run', '--if-stale']]) {
      const logs: string[] = []
      assert.equal(await main(argv, { writer: never, log: (l) => logs.push(l) }), 0)
      assert.equal((await storedEntries()).size, 0)
      const summary = logs.find((l) => /^dry run/.test(l))!
      assert.match(summary, new RegExp(`would write ${total} entries, \\d+ B, largest warm/v1/`))
    }
  })

  it('--dry-run --if-stale after a full run reports 0 entries to write', async () => {
    assert.equal(await run([]), 0)
    const before = await storedEntries()
    const logs: string[] = []
    assert.equal(await main(['--dry-run', '--if-stale'], { log: (l) => logs.push(l) }), 0)
    assert.match(logs.find((l) => /^dry run/.test(l))!, /would write 0 entries, 0 B, largest none, \d+ windows already up to date, 0 failed/)
    assert.deepEqual(await storedEntries(), before)
  })
})

describe('the workflows', () => {
  const step = (file: string, command: string) => {
    const text = fileText(`.github/workflows/${file}`)
    const at = text.indexOf(`- run: ${command}`)
    assert.notEqual(at, -1, `${file} has no ${command} step`)
    const next = text.indexOf('- run:', at + 1)
    return { text, at, slice: text.slice(at, next === -1 ? undefined : next) }
  }

  it('both run materialize in order, continue-on-error, with the timeout-minutes 20 and 15', () => {
    const ingest = step('ingest.yml', 'pnpm materialize')
    assert.ok(ingest.at > ingest.text.indexOf('- run: pnpm ingest'))
    assert.ok(ingest.at < ingest.text.indexOf('cache dangerously-delete'))
    assert.match(ingest.slice, /continue-on-error: true/)
    assert.match(ingest.slice, /timeout-minutes: 20\b/)

    const warm = step('warm.yml', 'pnpm materialize --if-stale')
    assert.ok(warm.at > warm.text.indexOf('- run: pnpm aggregate --if-missing'))
    assert.ok(warm.at < warm.text.indexOf('cache dangerously-delete'))
    assert.match(warm.slice, /continue-on-error: true/)
    assert.match(warm.slice, /timeout-minutes: 15\b/)
  })

  it('neither workflow carries the Blob variables any more, and both still pass TESTIMONY_REVISION', () => {
    for (const file of ['ingest.yml', 'warm.yml']) {
      const text = fileText(`.github/workflows/${file}`)
      assert.doesNotMatch(text, /BLOB_READ_WRITE_TOKEN|WARM_STORE_URL/, file)
      assert.match(text, /TESTIMONY_REVISION: \$\{\{ vars\.TESTIMONY_REVISION \}\}/, file)
      assert.doesNotMatch(text, /^\s*TESTIMONY_DTYPE:/m, file)
    }
  })
})

describe('materialising into warm_entries (issue #317 acceptance)', () => {
  before(built)
  after(restore)

  const everyPathname = () => warmRecortes(ids).map((r) => r.pathname).sort()
  const rows = async () => (await db.query<{ pathname: string; person_id: string }>(`select pathname, person_id from warm_entries order by pathname`)).rows
  const noEnvironment = () => {
    for (const name of ['BLOB_READ_WRITE_TOKEN', 'WARM_STORE_URL']) delete process.env[name]
  }

  it('main([], { log }) with no token or URL writes exactly warmRecortes\' pathnames, each row with its own person, exits 0, and a second run leaves the same row count (AC13)', async () => {
    noEnvironment()
    await db.exec(`delete from warm_entries`)
    const logs: string[] = []
    assert.equal(await main([], { log: (l) => logs.push(l) }), 0)
    assert.ok(logs.length > 0)
    assert.ok(logs.every((l) => !/no warm store configured/i.test(l)), logs.join('\n'))
    const first = await rows()
    assert.deepEqual(first.map((r) => r.pathname), everyPathname())
    const owner = new Map(warmRecortes(ids).map((r) => [r.pathname, r.personId]))
    for (const row of first) assert.equal(row.person_id, owner.get(row.pathname), row.pathname)
    assert.equal(await main([], { log: quiet }), 0)
    assert.deepEqual(await rows(), first)
  })

  it('a writer that rejects every pathname of one person fails the run, names that person and the error, and every other person\'s rows are stored (AC14)', async () => {
    noEnvironment()
    await db.exec(`delete from warm_entries`)
    const logs: string[] = []
    const refuse: WarmWriter = {
      put: (r, text) => (r.personId === 'tarcisio' ? Promise.reject(new Error('refused by the test writer')) : pgWarmStore.put(r, text)),
    }
    assert.equal(await main([], { writer: refuse, log: (l) => logs.push(l) }), 1)
    assert.ok(logs.some((l) => /tarcisio/.test(l) && /refused by the test writer/.test(l)), logs.join('\n'))
    const stored = (await rows()).map((r) => r.pathname)
    const expected = warmRecortes(ids).filter((r) => r.personId !== 'tarcisio').map((r) => r.pathname).sort()
    assert.equal(expected.length, 12)
    assert.deepEqual(stored, expected)
    assert.equal((await rows()).filter((r) => r.person_id === 'tarcisio').length, 0)
  })

  it('--if-stale after a full run exits 0, writes nothing and runs only the person, graph_scopes, warm_entries and aggregate-probe statements (AC15)', async () => {
    noEnvironment()
    assert.equal(await main([], { log: quiet }), 0)
    const before = await rows()
    const probe = await recordStatements(async () => void (await hasGraphAggregates()))
    assert.equal(probe.length, 1)
    const puts: string[] = []
    const writer: WarmWriter = { put: (r, text) => (puts.push(r.pathname), pgWarmStore.put(r, text)) }
    let code = -1
    const statementsRun = await recordStatements(async () => void (code = await main(['--if-stale'], { writer, log: quiet })))
    assert.equal(code, 0)
    assert.deepEqual(puts, [])
    assert.deepEqual(await rows(), before)
    assert.ok(statementsRun.length > 0)
    for (const s of statementsRun) {
      const allowed = s === probe[0] || /\bfrom persons\b/.test(s) || /\bfrom graph_scopes\b/.test(s) || /\bfrom warm_entries\b/.test(s)
      assert.ok(allowed, `unexpected statement on an up-to-date table: ${s.trim().slice(0, 100)}`)
      if (s !== probe[0]) assert.doesNotMatch(s, /graph_terms|term_communities|term_links|doc_terms|doc_testimony|\binsert\b|\bupdate\b|\bdelete\b/i)
    }
    assert.ok(statementsRun.some((s) => /\bfrom warm_entries\b/.test(s)))
    assert.ok(statementsRun.some((s) => /\bfrom graph_scopes\b/.test(s)))
  })

  it('--if-stale rewrites exactly the three entries of a window whose built_at moved, and everything once warm_entries is emptied (AC15)', async () => {
    noEnvironment()
    assert.equal(await main([], { log: quiet }), 0)
    const puts: string[] = []
    const writer: WarmWriter = { put: (r, text) => (puts.push(r.pathname), pgWarmStore.put(r, text)) }

    await db.exec(`update graph_scopes set built_at = built_at + interval '1 minute' where person_id = 'tarcisio' and days = 21`)
    assert.equal(await main(['--if-stale'], { writer, log: quiet }), 0)
    const window = warmRecortes(ids).filter((r) => r.personId === 'tarcisio' && r.days === 21)
    assert.equal(window.length, 3)
    assert.deepEqual(puts.sort(), window.map((r) => r.pathname).sort())
    const { rows: scope } = await db.query<{ built_at: string }>(`select built_at::text as built_at from graph_scopes where person_id = 'tarcisio' and days = 21 and source = 'all'`)
    const stored = await storedEntries()
    for (const r of window) assert.equal(splitEntry(stored.get(r.pathname)!)!.key, scope[0].built_at, r.pathname)

    puts.length = 0
    assert.equal(await main(['--if-stale'], { writer, log: quiet }), 0)
    assert.deepEqual(puts, [], 'now up to date again')

    await db.exec(`delete from warm_entries`)
    assert.equal(await main(['--if-stale'], { writer, log: quiet }), 0)
    assert.deepEqual(puts.sort(), everyPathname())
  })

  it('--dry-run leaves warm_entries unchanged, also with --if-stale, whatever writer it is given, and logs would write N entries with a byte total and the largest pathname (AC16)', async () => {
    noEnvironment()
    await db.exec(`delete from warm_entries`)
    assert.equal(await main([], { log: quiet }), 0)
    const full = await storedEntries()
    const sizes = [...full].map(([pathname, body]) => ({ pathname, bytes: Buffer.byteLength(body) }))
    const total = sizes.reduce((sum, e) => sum + e.bytes, 0)
    const largest = sizes.reduce((best, e) => (e.bytes > best.bytes ? e : best)).pathname
    const never: WarmWriter = { put: () => Promise.reject(new Error('a dry run must not write')) }

    await db.exec(`delete from warm_entries`)
    for (const argv of [['--dry-run'], ['--dry-run', '--if-stale']]) {
      const logs: string[] = []
      assert.equal(await main(argv, { writer: never, log: (l) => logs.push(l) }), 0, argv.join(' '))
      assert.equal((await rows()).length, 0, `${argv.join(' ')} wrote to warm_entries`)
      const text = logs.join('\n')
      assert.match(text, new RegExp(`would write ${warmRecortes(ids).length} entries`), argv.join(' '))
      assert.match(text, new RegExp(`\\b${total}\\b`), 'the byte total')
      assert.ok(text.includes(largest), 'the largest pathname')
    }
  })

  it('--dry-run --if-stale reads the real table: 0 entries after a full run, one window\'s three when its built_at moved (AC16)', async () => {
    noEnvironment()
    assert.equal(await main([], { log: quiet }), 0)
    const before = await storedEntries()
    const dry = async () => {
      const logs: string[] = []
      assert.equal(await main(['--dry-run', '--if-stale'], { log: (l) => logs.push(l) }), 0)
      return logs.join('\n')
    }
    assert.match(await dry(), /would write 0 entries/)
    await db.exec(`update graph_scopes set built_at = built_at + interval '1 minute' where person_id = 'lula' and days = 7`)
    assert.match(await dry(), /would write 3 entries/)
    assert.deepEqual(await storedEntries(), before)
  })

  it('with no aggregate build main exits 1, writes nothing and says there are no graph aggregates (AC17)', async () => {
    noEnvironment()
    await db.exec(`delete from warm_entries`)
    await db.exec(`delete from graph_terms`)
    await db.exec(`delete from graph_scopes`)
    try {
      const logs: string[] = []
      const puts: string[] = []
      const writer: WarmWriter = { put: (r, text) => (puts.push(r.pathname), pgWarmStore.put(r, text)) }
      assert.equal(await main([], { writer, log: (l) => logs.push(l) }), 1)
      assert.deepEqual(puts, [])
      assert.equal((await rows()).length, 0)
      assert.match(logs.join('\n'), /no graph aggregates/i)
    } finally {
      await restore()
    }
  })

  it('an about>0 scope without graph_terms skips only its graph entry, and an about=0 scope is written with nodes [] and links [] (AC17)', async () => {
    noEnvironment()
    await db.exec(`delete from warm_entries`)
    const { rows: scopes } = await db.query<{ person_id: string; days: number; about: number }>(`select person_id, days, about from graph_scopes where source = 'all'`)
    const aboutOf = (person: string, days: number) => scopes.find((s) => s.person_id === person && s.days === days)!.about
    assert.ok(aboutOf('lula', 7) > 0)
    assert.equal(aboutOf('bolsonaro', 7), 0)
    await db.exec(`delete from graph_terms where person_id = 'lula' and days = 7`)
    try {
      await main([], { log: quiet })
      const stored = await storedEntries()
      const lula7 = warmRecortes(ids).filter((r) => r.personId === 'lula' && r.days === 7)
      assert.equal(lula7.length, 3)
      for (const r of lula7) assert.equal(stored.has(r.pathname), r.route !== 'graph', `${r.route} of lula 7d`)
      assert.equal(stored.size, warmRecortes(ids).length - 1, 'every other entry is written')
      for (const r of warmRecortes(ids).filter((r) => r.personId === 'bolsonaro' && r.route === 'graph')) {
        const body = JSON.parse(splitEntry(stored.get(r.pathname)!)!.body)
        assert.deepEqual([body.nodes, body.links], [[], []], r.path)
      }
    } finally {
      await restore()
    }
  })
})

describe('the workflows no longer carry the Blob settings (issue #317 acceptance)', () => {
  const lines = (file: string) => fileText(`.github/workflows/${file}`).split('\n')
  const stepAt = (all: string[], command: RegExp) => {
    const start = all.findIndex((l) => /^\s*- run:/.test(l) && command.test(l))
    assert.notEqual(start, -1, `no step matching ${command}`)
    const indent = all[start].match(/^\s*/)![0].length
    const end = all.findIndex((l, i) => i > start && new RegExp(`^\\s{${indent}}- `).test(l))
    return { start, block: all.slice(start, end === -1 ? undefined : end).join('\n') }
  }

  const cases: [string, RegExp, number][] = [
    ['ingest.yml', /pnpm ingest\b/, 20],
    ['warm.yml', /pnpm aggregate --if-missing/, 15],
  ]
  for (const [file, collecting, minutes] of cases) {
    it(`${file} names neither variable, still passes TESTIMONY_REVISION, and runs pnpm materialize after its collecting step and before the cache purge, continue-on-error, ${minutes} minutes (AC19)`, () => {
      const text = fileText(`.github/workflows/${file}`)
      assert.doesNotMatch(text, /BLOB_READ_WRITE_TOKEN/)
      assert.doesNotMatch(text, /WARM_STORE_URL/)
      assert.match(text, /^\s*TESTIMONY_REVISION:/m)
      const all = lines(file)
      const materialize = stepAt(all, /pnpm materialize\b/)
      assert.ok(stepAt(all, collecting).start < materialize.start, 'after the collecting step')
      assert.ok(materialize.start < all.findIndex((l) => /cache dangerously-delete/.test(l)), 'before the cache purge')
      assert.match(materialize.block, /continue-on-error: true/)
      assert.match(materialize.block, new RegExp(`timeout-minutes: ${minutes}\\b`))
    })
  }
})
