import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { db } from '../src/db.js'
import { statements } from '../src/graph.js'
import { main } from '../src/materialize.js'
import { memoryWarmStore, splitEntry, warmRecortes } from '../src/warmstore.js'
import type { BlobPut } from '../src/warmstore-blob.js'
import { persons } from './fixture.js'
import { built, materialized, recordStatements, restore } from './warmstore-helpers.js'
import './close.js'

const ids = persons.map((p) => ({ id: p.id }))
const pathnamesOf = (personId: string) => warmRecortes(ids).filter((r) => r.personId === personId)
const fileText = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')

// A stand-in for the SDK's put that lands in a memory store, and can be told to fail a pathname.
const recordingPut = (store = memoryWarmStore(), failing: (pathname: string) => boolean = () => false) => {
  const puts: string[] = []
  const put: BlobPut = async (pathname, body) => {
    if (failing(pathname)) throw new Error(`put refused ${pathname}`)
    puts.push(pathname)
    store.entries.set(pathname, body)
  }
  return { store, puts, put }
}

const withToken = { BLOB_READ_WRITE_TOKEN: 'token' }

describe('materialising', () => {
  before(built)
  after(restore)

  it('never runs linksQuery or linksFastQuery: the links come from the build\'s own edges', async () => {
    const texts = await recordStatements(async () => void (await materialized()))
    assert.ok(texts.length > 0)
    assert.equal(texts.filter((t) => t === statements.links || t === statements.linksFast).length, 0)
  })

  it('writes the same pathnames on every run, so the store never grows', async () => {
    const first = (await materialized()).store
    const second = (await materialized()).store
    assert.deepEqual([...first.entries.keys()].sort(), [...second.entries.keys()].sort())
    assert.equal(first.entries.size, warmRecortes(ids).length)
  })
})

describe('a failing run', () => {
  before(built)
  after(restore)

  it('one failing person does not stop the others, and the run reports it', async () => {
    const { store, puts, put } = recordingPut(undefined, (p) => p.startsWith('warm/v1/lula/'))
    const logs: string[] = []
    const code = await main([], withToken, { put, log: (l) => logs.push(l) })
    assert.equal(code, 1)
    assert.equal(puts.length, warmRecortes(ids).length - 6)
    assert.ok(puts.every((p) => !p.startsWith('warm/v1/lula/')))
    assert.ok(puts.some((p) => p.startsWith('warm/v1/tarcisio/')) && puts.some((p) => p.startsWith('warm/v1/bolsonaro/')))
    assert.ok(logs.some((l) => /lula/.test(l) && /put refused/.test(l)))
    assert.equal(store.entries.size, puts.length, 'a failed entry is never half-written')
  })

  it('with no aggregate build it writes nothing and says why', async () => {
    await db.exec(`delete from graph_terms`)
    await db.exec(`delete from graph_scopes`)
    try {
      const { puts, put } = recordingPut()
      const logs: string[] = []
      assert.equal(await main([], withToken, { put, log: (l) => logs.push(l) }), 1)
      assert.equal(puts.length, 0)
      assert.match(logs.join('\n'), /no graph aggregates/)
    } finally {
      await restore()
    }
  })

  it('an about>0 scope without terms skips only its graph entry; an about=0 scope without terms is written', async () => {
    await db.exec(`delete from graph_terms where person_id = 'lula' and days = 7`)
    try {
      const { store, puts, put } = recordingPut()
      const logs: string[] = []
      const code = await main([], withToken, { put, log: (l) => logs.push(l) })
      assert.equal(code, 0)
      const lula7 = pathnamesOf('lula').filter((r) => r.days === 7)
      assert.deepEqual(puts.filter((p) => lula7.some((r) => r.pathname === p)).sort(), lula7.filter((r) => r.route !== 'graph').map((r) => r.pathname).sort())
      assert.ok(logs.some((l) => /lula 7d/.test(l) && /graph entry skipped/.test(l)))
      assert.equal(puts.length, warmRecortes(ids).length - 1)
      const bolsonaro = pathnamesOf('bolsonaro')
      assert.ok(bolsonaro.every((r) => store.entries.has(r.pathname)))
      const graph = bolsonaro.find((r) => r.route === 'graph' && r.days === 7)!
      const body = JSON.parse(splitEntry(store.entries.get(graph.pathname)!)!.body)
      assert.deepEqual([body.nodes, body.links], [[], []])
    } finally {
      await restore()
    }
  })
})

describe('without a token', () => {
  it('skips with exit 0, no put and no statement, also with --if-stale', async () => {
    const put: BlobPut = async () => {
      throw new Error('put must not be called')
    }
    for (const argv of [[], ['--if-stale']]) {
      for (const env of [{}, { BLOB_READ_WRITE_TOKEN: '' }]) {
        const logs: string[] = []
        let code = -1
        const texts = await recordStatements(async () => void (code = await main(argv, env, { put, log: (l) => logs.push(l) })))
        assert.equal(code, 0)
        assert.deepEqual(logs, ['no warm store configured, skipping'])
        assert.deepEqual(texts, [])
      }
    }
  })
})

describe('--if-stale and --dry-run', () => {
  before(built)
  after(restore)

  it('checks the stored keys before building anything and rewrites only what changed', async () => {
    const { store, puts, put } = recordingPut()
    const run = (reader: { get: (p: string, k: string) => Promise<string | null> } = store) => main(['--if-stale'], withToken, { put, reader, log: () => undefined })
    const total = warmRecortes(ids).length

    assert.equal(await run(), 0)
    assert.equal(puts.length, total, 'an empty store is rewritten whole')

    puts.length = 0
    const texts = await recordStatements(async () => void (await run()))
    assert.equal(puts.length, 0)
    const reads = [/^select built_at::text as built_at, about from graph_scopes/, /from persons/, /^\s*select exists \(select 1 from graph_scopes\)/]
    for (const t of texts) assert.ok(reads.some((r) => r.test(t)), `unexpected statement on an up-to-date store: ${t.slice(0, 80)}`)
    assert.ok(texts.every((t) => !/graph_terms/.test(t) || /^\s*select exists/.test(t)))

    await db.exec(`update graph_scopes set built_at = built_at + interval '1 second' where person_id = 'lula' and days = 7 and source = 'all'`)
    assert.equal(await run(), 0)
    assert.deepEqual(puts.sort(), pathnamesOf('lula').filter((r) => r.days === 7).map((r) => r.pathname).sort())

    puts.length = 0
    assert.equal(await run({ get: async () => null }), 0)
    assert.equal(puts.length, total, 'with no store to read from, everything is rewritten')
  })

  it('writes nothing to any real store on --dry-run, needs neither token nor url, and reports size', async () => {
    const put: BlobPut = async () => {
      throw new Error('put must not be called')
    }
    const logs: string[] = []
    assert.equal(await main(['--dry-run'], {}, { put, log: (l) => logs.push(l) }), 0)
    const summary = logs.find((l) => /^dry run/.test(l))!
    assert.match(summary, new RegExp(`would write ${warmRecortes(ids).length} entries, \\d+ B, largest warm/v1/`))
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

  it('both run materialize in order, carry the env, continue-on-error, and the timeout-minutes 20 and 15', () => {
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

    for (const { text } of [ingest, warm]) {
      assert.match(text, /BLOB_READ_WRITE_TOKEN: \$\{\{ secrets\.BLOB_READ_WRITE_TOKEN \}\}/)
      assert.match(text, /WARM_STORE_URL: \$\{\{ vars\.WARM_STORE_URL \}\}/)
      assert.match(text, /TESTIMONY_REVISION: \$\{\{ vars\.TESTIMONY_REVISION \}\}/)
      assert.doesNotMatch(text, /^\s*TESTIMONY_DTYPE:/m)
    }
  })
})

describe('the dependency', () => {
  it('package.json pins @vercel/blob exactly and the lockfile agrees', () => {
    const pkg = JSON.parse(fileText('package.json')) as { dependencies: Record<string, string> }
    const version = pkg.dependencies['@vercel/blob']
    assert.match(version, /^\d+\.\d+\.\d+$/, 'no ^ or ~')
    assert.ok(Number(version.split('.')[0]) >= 1)
    const lock = fileText('pnpm-lock.yaml')
    assert.match(lock, new RegExp(`'@vercel/blob':\\s+specifier: ${version.replace(/\./g, '\\.')}\\s+version: ${version.replace(/\./g, '\\.')}`))
    assert.match(lock, new RegExp(`^  '@vercel/blob@${version.replace(/\./g, '\\.')}':`, 'm'))
  })
})
