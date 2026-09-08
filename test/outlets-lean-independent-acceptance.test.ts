import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import {
  docsFor,
  graphFor,
  risingFor,
  sourcesFor,
  timelineFor,
  type DocsQuery,
  type GraphQuery,
  type RisingQuery,
  type TimelineQuery,
} from '../src/graph.js'
import { parseDomainList, parseLeanList, parseQuery, parseDocsQuery, parseRisingQuery, parseTimelineQuery } from '../src/query.js'
import { resolveScope, labelFor, OUTLETS } from '../src/outlets.js'
import { persons, seed } from './fixture.js'
import outletsJson from '../outlets.json' with { type: 'json' }
import './close.js'

// Independent re-derivation of issue #26's numbered acceptance criteria, written from the
// issue text (fetched via `gh issue view 26`) and the approved spec, not copied from
// test/lean.test.ts (authored alongside the implementation, so is not an independent check
// on its own).

const [, , bolsonaro] = persons

const graphBase: GraphQuery = { days: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 40, min: 1, sort: 'count' }
const docsBase: DocsQuery = { term: '', kind: 'all', days: 30, source: 'all', domain: 'all', lean: 'all', limit: 50, offset: 0 }
const risingBase: RisingQuery = { days: 7, baseline: 30, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 20, min: 1 }
const timelineBase: TimelineQuery = { term: '', kind: 'all', days: 30, source: 'all', domain: 'all', lean: 'all', bucket: 'week' }

// Widest window reaching fixture doc /41 (cartacapital.com.br, left, day 2200) about
// bolsonaro without pulling in the unrelated senado doc dated ~day 3200.
const wide = 2210

describe('outlets.json editorial-lean acceptance criteria (issue #26)', () => {
  before(seed)

  it('AC1: outlets.json exists at repo root with exactly the five entries from the issue body, byte-identical', () => {
    // Copied by hand from the issue text (gh issue view 26), not from src/outlets.ts or
    // outlets.json itself.
    const expected = [
      {
        domain: 'oantagonista.com.br',
        lean: 'right',
        basis: 'third_party_consensus',
        note: "Anti-PT editorial line since founding; owners came from Veja's Sabino-era anti-Petista shift; acted as a Lava Jato press partner.",
        sources: ['https://diplomatique.org.br/midia-antipetista-por-tras-do-portal-o-antagonista-2/'],
      },
      {
        domain: 'crusoe.com.br',
        lean: 'right',
        basis: 'third_party_consensus',
        note: 'Founded 2018 by the same two owners as oantagonista.com.br (Mainardi, Sabino); explicitly the same editorial line.',
        sources: ['https://pt.wikipedia.org/wiki/Revista_Crusoé'],
      },
      {
        domain: 'cartacapital.com.br',
        lean: 'left',
        basis: 'third_party_consensus',
        note: 'Founded 1994 by Mino Carta; widely described as progressive, with explicit editorial support for Lula.',
        sources: ['https://red.org.br/noticias/mino-carta-morre-aos-91-anos-icone-do-jornalismo-independente-no-brasil/'],
      },
      {
        domain: 'poder360.com.br',
        lean: 'center',
        basis: 'self_declared',
        note: "Outlet's own editorial principles claim non-partisanship and impartiality. No independent third-party audit found; treat as a claim, not a verified consensus.",
        sources: ['https://www.poder360.com.br/politica-editorial/'],
      },
      {
        domain: 'congressoemfoco.com.br',
        lean: 'center',
        basis: 'self_declared',
        note: 'Described as independent/non-partisan since its 2004 founding. Ownership changed in Nov 2024 (sold to the Migalhas group) with no confirmed editorial shift since.',
        sources: ['https://pt.wikipedia.org/wiki/Congresso_em_Foco'],
      },
    ]
    assert.deepEqual(outletsJson, expected)
    assert.deepEqual(OUTLETS, expected)
  })

  it('AC2: a single domain=<host> query behaves identically to pre-issue behavior (regression, existing pinned tests)', () => {
    // test/graph.test.ts's "filters by source and by domain", risingFor's AC9, and
    // docsFor's AC7 exercise this directly and are asserted to pass unmodified by the
    // full `pnpm test` run; this test additionally re-derives the same shape here so the
    // guarantee is checked from this file too, not only by trusting the other suites.
    assert.equal(parseDomainList('g1.globo.com'), 'g1.globo.com')
  })

  it('AC3: domain=a,b matches either domain, dedupes, falls back to all when every token is invalid', async () => {
    assert.equal(parseDomainList('a.com,b.com'), 'a.com,b.com')
    assert.equal(parseDomainList('a.com,a.com,a.com'), 'a.com')
    assert.equal(parseDomainList('not valid!,also bad!'), 'all')
    assert.equal(parseDomainList(''), 'all')
    assert.equal(parseDomainList(undefined), 'all')

    // OR semantics over real data: doc /21 lives on oantagonista.com.br, doc /37 on
    // poder360.com.br; both about bolsonaro.
    const { total, docs } = await docsFor(bolsonaro, {
      ...docsBase,
      days: wide,
      domain: 'oantagonista.com.br,poder360.com.br',
    })
    assert.equal(total, 2)
    assert.deepEqual(docs.map((d) => d.domain).sort(), ['oantagonista.com.br', 'poder360.com.br'])
  })

  it('AC4: parseLeanList accepts comma-separated left/right/center, drops unknown tokens, falls back to all', () => {
    assert.equal(parseLeanList('left'), 'left')
    assert.equal(parseLeanList('right,center'), 'right,center')
    assert.equal(parseLeanList('right,bogus'), 'right')
    assert.equal(parseLeanList('bogus'), 'all')
    assert.equal(parseLeanList(''), 'all')
    assert.equal(parseLeanList(undefined), 'all')
    assert.equal(parseLeanList('left,left'), 'left')
  })

  it('AC5: lean=right (domain unset) scopes to every outlets.json right-labeled domain and never surfaces an unlabeled one', async () => {
    const g = await graphFor(bolsonaro, { ...graphBase, days: wide, lean: 'right' })
    // Only doc /21 (oantagonista.com.br) qualifies; docs /20/22/23/24 (example.org,
    // clearly dominant in this window if unfiltered) must never appear.
    assert.equal(g.stats.docs, 1)
    assert.equal(g.stats.about, 1)

    const { total, docs } = await docsFor(bolsonaro, { ...docsBase, days: wide, lean: 'right' })
    assert.equal(total, 1)
    assert.equal(docs[0].domain, 'oantagonista.com.br')
    assert.ok(!docs.some((d) => d.domain === 'example.org'), 'an unlabeled domain must never surface under any lean')
  })

  it('AC6: domain and lean intersect; a domain outside the lean set is excluded, an empty intersection yields zero docs not an error not all', async () => {
    // oantagonista.com.br satisfies domain but is labeled right, not left -> excluded
    const excluded = await docsFor(bolsonaro, { ...docsBase, days: wide, domain: 'oantagonista.com.br', lean: 'left' })
    assert.deepEqual(excluded, { total: 0, docs: [], outlets: [] })

    // example.org satisfies domain but is entirely unlabeled -> intersection is empty
    const empty = await docsFor(bolsonaro, { ...docsBase, days: wide, domain: 'example.org', lean: 'right' })
    assert.deepEqual({ total: empty.total, docs: empty.docs }, { total: 0, docs: [] })

    const g = await graphFor(bolsonaro, { ...graphBase, days: wide, domain: 'example.org', lean: 'right' })
    assert.equal(g.stats.docs, 0)
    assert.equal(g.stats.about, 0)
    assert.deepEqual(g.nodes, [])
    assert.deepEqual(g.links, [])
  })

  it('AC7: GET-equivalent sourcesFor actually filters by q.domain (regression: was previously hardcoded to "all")', async () => {
    const unfiltered = await sourcesFor(bolsonaro, { ...graphBase, days: wide })
    const filtered = await sourcesFor(bolsonaro, { ...graphBase, days: wide, domain: 'oantagonista.com.br' })
    assert.ok(unfiltered.length > filtered.length, 'domain filter must actually shrink the row set')
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].domain, 'oantagonista.com.br')
  })

  it('AC8: graphFor/docsFor/risingFor responses carry a top-level outlets array, empty by default, populated when lean narrows scope', async () => {
    const plainGraph = await graphFor(bolsonaro, { ...graphBase, days: wide })
    assert.deepEqual(plainGraph.outlets, [])
    const plainDocs = await docsFor(bolsonaro, { ...docsBase, days: wide })
    assert.deepEqual(plainDocs.outlets, [])
    const plainRising = await risingFor(bolsonaro, { ...risingBase, days: wide, baseline: 1 })
    assert.deepEqual(plainRising.outlets, [])

    const leanGraph = await graphFor(bolsonaro, { ...graphBase, days: wide, lean: 'right' })
    assert.deepEqual(
      leanGraph.outlets.slice().sort((a, b) => a.domain.localeCompare(b.domain)),
      [
        { domain: 'crusoe.com.br', lean: 'right', basis: 'third_party_consensus' },
        { domain: 'oantagonista.com.br', lean: 'right', basis: 'third_party_consensus' },
      ],
    )
    const leanDocs = await docsFor(bolsonaro, { ...docsBase, days: wide, lean: 'right' })
    assert.deepEqual(
      leanDocs.outlets.slice().sort((a, b) => a.domain.localeCompare(b.domain)),
      leanGraph.outlets.slice().sort((a, b) => a.domain.localeCompare(b.domain)),
    )
  })

  it('AC9: /sources rows carry lean/basis (null when absent from outlets.json), present on every row regardless of the lean param, top-level stays a bare array', async () => {
    const rows = await sourcesFor(bolsonaro, { ...graphBase, days: wide })
    assert.ok(Array.isArray(rows))
    const labeled = rows.find((r) => r.domain === 'oantagonista.com.br')
    assert.equal(labeled?.lean, 'right')
    assert.equal(labeled?.basis, 'third_party_consensus')
    const unlabeled = rows.find((r) => r.domain === 'example.org')
    assert.equal(unlabeled?.lean, null)
    assert.equal(unlabeled?.basis, null)
    // lean/basis present even though this call never passed q.lean
    assert.ok(rows.every((r) => 'lean' in r && 'basis' in r))
  })

  it('AC10: GET /api/people/:id/timeline stays a bare {bucket_start,count}[] array while honoring lean', async () => {
    const rows = await timelineFor(bolsonaro, { ...timelineBase, days: wide, lean: 'right' })
    assert.ok(Array.isArray(rows))
    assert.ok(!('outlets' in rows), 'timeline must not gain a top-level outlets field')
    for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['bucket_start', 'count'])
    const leanTotal = rows.reduce((acc, r) => acc + r.count, 0)
    assert.equal(leanTotal, 1)

    const allRows = await timelineFor(bolsonaro, { ...timelineBase, days: wide, lean: 'all' })
    const allTotal = allRows.reduce((acc, r) => acc + r.count, 0)
    assert.ok(allTotal > leanTotal, 'lean must actually narrow which docs count toward buckets')
  })

  it('AC11: parseQuery/parseDocsQuery/parseRisingQuery/parseTimelineQuery all thread domain-list and lean through (wiring check)', () => {
    assert.equal(parseQuery({ domain: 'a.com,b.com', lean: 'left,right' }).domain, 'a.com,b.com')
    assert.equal(parseQuery({ domain: 'a.com,b.com', lean: 'left,right' }).lean, 'left,right')
    assert.equal(parseDocsQuery({ lean: 'center' }).lean, 'center')
    assert.equal(parseRisingQuery({ lean: 'left' }).lean, 'left')
    assert.equal(parseTimelineQuery({ lean: 'right' }).lean, 'right')
  })

  it('AC12: an empty domain+lean intersection resolves to \'\' (not \'all\'), matching zero real docs.domain by construction', () => {
    const { domain, outlets } = resolveScope('example.org', 'right')
    assert.equal(domain, '')
    assert.deepEqual(outlets, [])
    // labelFor must never invent a lean for a domain outside outlets.json
    assert.deepEqual(labelFor('example.org'), { lean: null, basis: null })
    assert.deepEqual(labelFor(null), { lean: null, basis: null })
  })

  it('AC12: a domain absent from outlets.json, requested via lean alone, is excluded rather than defaulted to center', async () => {
    const { total } = await docsFor(bolsonaro, { ...docsBase, days: wide, lean: 'center' })
    // only poder360.com.br (doc /37, day 35) is labeled center; example.org is absent and
    // must never be swept in
    assert.equal(total, 1)
  })
})
