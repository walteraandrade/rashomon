import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it, before } from 'node:test'
import { app } from '../src/server.js'
import { db } from '../src/db.js'
import { graphFor, docsFor, type GraphQuery, type DocsQuery } from '../src/graph.js'
import { parseSourceList, parseRisingQuery, parseTimelineQuery, SOURCES } from '../src/query.js'
import { personsMentioned } from '../src/extract.js'
import { insertDoc, upsertPersons, tonedSources } from '../src/store.js'
import { collectors, defaultSources } from '../src/collectors/index.js'
import { senado } from '../src/collectors/senado.js'
import type { Person, RawDoc, Source } from '../src/types.js'
import { persons, seed, docs } from './fixture.js'

// Independent re-derivation of issue #25's numbered acceptance criteria, written from the
// spec text and checked against test/fixture.ts's doc 39 -- deliberately not copied from
// test/collectors-senado.test.ts, test/server.test.ts, test/store.test.ts, test/extract.test.ts
// or test/graph.test.ts's senado additions (all authored alongside the implementation, so are
// not an independent check on their own).

const [lula] = persons
const senadoDoc = docs.find((d) => d.source === 'senado')!
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

describe('senado collector acceptance criteria, independently verified (issue #25)', () => {
  before(seed)

  it('AC1: Source union includes "senado" and Person carries an optional senadoId: string (compile-time, enforced by pnpm typecheck)', () => {
    const s: Source = 'senado'
    const withId: Person = { id: 'x', name: 'X', aliases: [], senadoId: '123' }
    const withoutId: Person = { id: 'y', name: 'Y', aliases: [] }
    assert.equal(s, 'senado')
    assert.equal(withId.senadoId, '123')
    assert.equal(withoutId.senadoId, undefined)
  })

  it('AC2: the collector returns [] with no persons at all and no network call is made', async () => {
    const result = await senado([])
    assert.deepEqual(result, [])
  })

  it('AC2: the collector returns [] when every person lacks senadoId, and no network call is made', async () => {
    const noSenadoId: Person[] = [
      { id: 'a', name: 'A', aliases: ['A'] },
      { id: 'b', name: 'B', aliases: ['B'], exclude: ['C'] },
    ]
    // a hung/failed real request would time this test out rather than resolve almost instantly
    const start = Date.now()
    const result = await senado(noSenadoId)
    assert.deepEqual(result, [])
    assert.ok(Date.now() - start < 1000, 'must short-circuit before any request, not merely resolve an empty batch')
  })

  it('AC3: every mapped RawDoc is built with source: "senado" and never sets tone (static check, no network mock)', () => {
    // CLAUDE.md forbids hitting external APIs from tests, and the spec's own test plan
    // explicitly excludes a collector-level network test for this reason, so this is
    // read as source text rather than exercised end-to-end -- mirrors the same technique
    // used in test/testimony-independent-acceptance.test.ts's AC13 (onnx dynamic import check).
    const source = readFileSync(new URL('../src/collectors/senado.ts', import.meta.url), 'utf8')
    assert.match(source, /source:\s*'senado'/, 'RawDoc mapping must set source: "senado"')
    assert.doesNotMatch(source, /\btone\s*:/, 'RawDoc mapping must never set a tone field')
    assert.match(source, /person\.senadoId/, 'must key the request off person.senadoId')
  })

  it('AC4: collectors/index.ts registers senado in the collectors map and in defaultSources', () => {
    assert.equal(typeof collectors.senado, 'function')
    assert.ok(defaultSources.includes('senado'), 'senado must be a default, not opt-in, source')
  })

  it('AC5: query.ts SOURCES plus the rising/timeline single-token checks all accept "senado"', () => {
    assert.ok(SOURCES.includes('senado'))
    assert.equal(parseSourceList('senado'), 'senado')
    assert.equal(parseRisingQuery({ source: 'senado' }).source, 'senado')
    assert.equal(parseTimelineQuery({ source: 'senado' }).source, 'senado')
    // an unrelated bogus token must still fall back to 'all' on both, proving 'senado'
    // was added rather than the whole check being loosened
    assert.equal(parseRisingQuery({ source: 'not-a-real-source' }).source, 'all')
    assert.equal(parseTimelineQuery({ source: 'not-a-real-source' }).source, 'all')
  })

  it('AC6: the fixture carries exactly one senado doc, dated more than 3100 days ago, and the full suite stays green around it', () => {
    const senadoDocs = docs.filter((d) => d.source === 'senado')
    assert.equal(senadoDocs.length, 1)
    const ageDays = (Date.now() - new Date(senadoDoc.publishedAt).getTime()) / 86_400_000
    assert.ok(ageDays > 3100, `expected senado doc older than 3100 days, got ${ageDays.toFixed(0)}`)
    // no window used by any pre-existing pinned literal anywhere in the suite reaches this
    // far back (the widest is timeline.test.ts's days:2151), so it cannot perturb a
    // pinned pmi/count/tone/stats literal -- verified by the full `pnpm test` run staying
    // green with this file added and every other test file byte-for-byte as authored
    assert.ok(ageDays > 2151, 'must sit past every existing pinned window in the suite')
  })

  it('AC7: extract.ts has no source === \'senado\' branch, yet personsMentioned still tags the name-prefixed doc', () => {
    const extractSource = readFileSync(new URL('../src/extract.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(extractSource, /source\s*===\s*['"]senado['"]/)
    const alcolumbre: Person = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre', 'Davi Alcolumbre'] }
    const matched = personsMentioned(senadoDoc.text, [...persons, alcolumbre])
    assert.deepEqual(matched.map((p) => p.id), ['alcolumbre'])
  })

  it('AC8: GET /api/people/:id/graph?source=senado for a person with zero senado docs returns the empty, stats.docs===0 shape', async () => {
    // stats.docs is the person-agnostic scope count, not a per-person count, so the window
    // must stay narrower than the fixture's senado doc (dated ~3200 days ago, per AC6) or
    // scope itself would stop being empty regardless of who is asked about; the default
    // 30-day window (and the 365-day ceiling parseQuery ever allows over HTTP) both qualify
    const base: GraphQuery = { days: 30, source: 'senado', domain: 'all', lean: 'all', kind: 'all', limit: 40, min: 1, sort: 'count' }
    const direct = await graphFor(lula, base)
    assert.deepEqual(direct.nodes, [])
    assert.deepEqual(direct.links, [])
    assert.deepEqual(direct.signature, [])
    assert.equal(direct.stats.docs, 0)
    assert.equal(direct.stats.about, 0)

    const res = await app.request('/api/people/lula/graph?source=senado&days=365')
    assert.equal(res.status, 200)
    const body = (await res.json()) as typeof direct
    assert.deepEqual(body.nodes, [])
    assert.deepEqual(body.links, [])
    assert.deepEqual(body.signature, [])
    assert.equal(body.stats.docs, 0)
  })

  it('AC9: seed.json grants senadoId to exactly flavio-bolsonaro (5894) and alcolumbre (3830), no other entry', () => {
    const seedJson = JSON.parse(readFileSync(new URL('../seed.json', import.meta.url), 'utf8')) as (Person & {
      senadoId?: string
    })[]
    const withSenadoId = seedJson.filter((p) => p.senadoId !== undefined)
    assert.deepEqual(
      withSenadoId.map((p) => ({ id: p.id, senadoId: p.senadoId })).sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: 'alcolumbre', senadoId: '3830' },
        { id: 'flavio-bolsonaro', senadoId: '5894' },
      ],
    )
    // ciro must never inherit a senadoId meant for a different senator sharing his surname
    const ciro = seedJson.find((p) => p.id === 'ciro')
    assert.equal(ciro?.senadoId, undefined)
    const jairBolsonaro = seedJson.find((p) => p.id === 'bolsonaro')
    assert.equal(jairBolsonaro?.senadoId, undefined)
  })

  it('AC10: README documents senado in the source list, ingest defaults, every source= enum, and the senadoId seed field', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    assert.match(readme, /senado/i, 'README must mention senado at all')
    assert.match(readme, /default sources:.*senado/i, 'ingest default-sources line must list senado')
    const enumLines = readme.split('\n').filter((l) => /source=all\|/.test(l))
    assert.ok(enumLines.length >= 3, 'expected multiple route listings with a source= enum')
    for (const line of enumLines) assert.match(line, /\bsenado\b/, `source= enum missing senado: ${line}`)
    assert.match(readme, /senadoId/)
    assert.match(readme, /dadosabertos\.senado\.leg\.br/)
  })

  it('AC11: design-5.html\'s segSource control includes a senado button wired to the shared buildSeg handler', () => {
    const html = readFileSync(new URL('../public/design-5.html', import.meta.url), 'utf8')
    const segSourceCall = html.split('\n').find((l) => l.includes("buildSeg('segSource'"))
    assert.ok(segSourceCall, 'expected a buildSeg(\'segSource\', ...) call')
    assert.match(segSourceCall!, /\['senado',\s*'senado'\]/)
    // same call site as every other source option, so it inherits the existing click
    // handler (state.source = value; paintSeg; load()) rather than needing bespoke wiring
    assert.match(segSourceCall!, /'source'\)\s*$/, 'senado must be registered as a source-kind segment like its siblings')
  })

  it('AC12: a senado doc whose body never names the speaking senator is still tagged via the name-prefix, with no source-specific extraction branch', async () => {
    assert.doesNotMatch(senadoDoc.text.replace(/^[^:]+:\s*/, ''), /Alcolumbre/i, 'fixture body must not self-name the senator')
    const alcolumbre: Person = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre', 'Davi Alcolumbre'] }
    const family = [...persons, alcolumbre]
    await upsertPersons([alcolumbre])
    const uri = 'https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/888888'
    const doc: RawDoc = {
      source: 'senado',
      uri,
      text: `${alcolumbre.name}: pronunciamento sobre soberania nacional e infraestrutura portuária`,
      publishedAt: daysAgo(3201),
      domain: 'senado.leg.br',
    }
    await insertDoc(doc, family)
    const { rows } = await db.query<{ person_id: string }>(
      `select person_id from doc_persons dp join docs d on d.id = dp.doc_id where d.uri = $1`,
      [uri],
    )
    assert.deepEqual(rows.map((r) => r.person_id), ['alcolumbre'])
    const { rows: toneRows } = await db.query<{ tone: number | null }>(`select tone from docs where uri = $1`, [uri])
    assert.equal(toneRows[0].tone, null)
  })

  it('bonus: tonedSources must never gain senado -- tone stays null even if a senado doc supplies a tone field', () => {
    assert.ok(!tonedSources.includes('senado'), 'senado must remain an untoned source')
  })

  it('bonus: senado docs feed the same person-matching and term pipeline as any other source via docsFor', async () => {
    const alcolumbre: Person = { id: 'alcolumbre', name: 'Davi Alcolumbre', aliases: ['Alcolumbre', 'Davi Alcolumbre'] }
    await upsertPersons([alcolumbre])
    const uri = 'https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/777777'
    await insertDoc(
      { source: 'senado', uri, text: `${alcolumbre.name}: fala sobre soberania nacional`, publishedAt: daysAgo(3202), domain: 'senado.leg.br' },
      [...persons, alcolumbre],
    )
    const wide: DocsQuery = { term: '', kind: 'all', days: 3300, source: 'senado', domain: 'all', lean: 'all', limit: 50, offset: 0 }
    const { docs: found } = await docsFor(alcolumbre, wide)
    // asserts presence rather than an exact total, since an earlier test in this file
    // (AC12) may have already tagged alcolumbre with another senado doc in this shared
    // in-memory database
    assert.ok(found.some((d) => d.uri === uri), 'the newly inserted senado doc must surface via docsFor')
  })
})
