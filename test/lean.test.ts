import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { docsFor, graphFor, risingFor, sourcesFor, timelineFor, type DocsQuery, type GraphQuery, type RisingQuery, type TimelineQuery } from '../src/graph.js'
import { readFileSync } from 'node:fs'
import { parseDomainList, parseLeanList } from '../src/query.js'
import { OUTLETS } from '../src/outlets.js'
import { persons, seed } from './fixture.js'
import outletsJson from '../outlets.json' with { type: 'json' }
import { params, sourcesParams } from '../public/js/api.js'
import './close.js'

const [, , bolsonaro] = persons

// Widest window that reaches doc /41 (cartacapital.com.br, left, day 2200) without
// touching anything past it (senado doc /40 sits at day 3200).
const wideBase: GraphQuery = { days: 2210, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 40, min: 1, sort: 'count' }
const wideDocs: DocsQuery = { term: '', kind: 'all', days: 2210, source: 'all', domain: 'all', lean: 'all', limit: 50, offset: 0 }

describe('outlets.json content matches the issue specification exactly', () => {
  it('deep-equals a literal copy of the five entries', () => {
    assert.deepEqual(outletsJson, [
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
    ])
    assert.deepEqual(OUTLETS, outletsJson)
  })
})

describe('parseLeanList', () => {
  it('parses a comma-separated lean list, drops unknown tokens, falls back to all', () => {
    assert.equal(parseLeanList('left,right'), 'left,right')
    assert.equal(parseLeanList('left,bogus'), 'left')
    assert.equal(parseLeanList('bogus1,bogus2'), 'all')
    assert.equal(parseLeanList(''), 'all')
    assert.equal(parseLeanList(undefined), 'all')
    assert.equal(parseLeanList('left,left'), 'left')
  })
})

describe('parseDomainList', () => {
  it('parses a comma-separated domain list, dedupes, falls back to all', () => {
    // single-token case: identical to the pre-existing single-domain behaviour
    assert.equal(parseDomainList('a.com'), 'a.com')
    assert.equal(parseDomainList('a.com,b.com'), 'a.com,b.com')
    assert.equal(parseDomainList('a.com,a.com'), 'a.com')
    assert.equal(parseDomainList(''), 'all')
    assert.equal(parseDomainList(undefined), 'all')
    assert.equal(parseDomainList('BAD SPACE!'), 'all')
    assert.equal(parseDomainList('a.com,BAD SPACE!'), 'a.com')
  })
})

describe('lean filtering (issue #26)', () => {
  before(seed)

  it('domain=cartacapital.com.br,poder360.com.br behaves as an OR across both domains', async () => {
    const { total, docs } = await docsFor(bolsonaro, { ...wideDocs, domain: 'cartacapital.com.br,poder360.com.br' })
    assert.equal(total, 2)
    assert.deepEqual(docs.map((d) => d.domain).sort(), ['cartacapital.com.br', 'poder360.com.br'])
  })

  it('lean=right scopes to outlets.json right-labeled domains and excludes an unlabeled domain', async () => {
    const g = await graphFor(bolsonaro, { ...wideBase, lean: 'right' })
    assert.equal(g.stats.docs, 1)
    assert.equal(g.stats.about, 1)
    const { total, docs } = await docsFor(bolsonaro, { ...wideDocs, lean: 'right' })
    assert.equal(total, 1)
    assert.equal(docs[0].domain, 'oantagonista.com.br')
    // doc /20/22/23/24 (example.org, absent from outlets.json) never surface under any lean
    assert.ok(!docs.some((d) => d.domain === 'example.org'))
  })

  it('lean=left,right unions both labels and still excludes center and unlabeled', async () => {
    const { total, docs } = await docsFor(bolsonaro, { ...wideDocs, lean: 'left,right' })
    assert.equal(total, 2)
    assert.deepEqual(docs.map((d) => d.domain).sort(), ['cartacapital.com.br', 'oantagonista.com.br'])
    assert.ok(!docs.some((d) => d.domain === 'poder360.com.br'), 'poder360.com.br is center, must be excluded')
    assert.ok(!docs.some((d) => d.domain === 'example.org'), 'example.org is unlabeled, must be excluded')
  })

  it('domain and lean intersect; an empty intersection returns zero docs, not all', async () => {
    const { total, docs } = await docsFor(bolsonaro, { ...wideDocs, domain: 'example.org', lean: 'right' })
    assert.deepEqual({ total, docs }, { total: 0, docs: [] })
    const g = await graphFor(bolsonaro, { ...wideBase, domain: 'example.org', lean: 'right' })
    assert.equal(g.stats.docs, 0)
    assert.equal(g.stats.about, 0)
    assert.deepEqual(g.nodes, [])
  })

  it('outlets is empty when lean is unset and populated with basis when lean narrows the scope', async () => {
    const plain = await graphFor(bolsonaro, wideBase)
    assert.deepEqual(plain.outlets, [])

    // lean=right resolves to every outlets.json domain labeled right, not only the ones
    // that happen to have a doc in this window's corpus (crusoe.com.br has none here).
    const scoped = await graphFor(bolsonaro, { ...wideBase, lean: 'right' })
    assert.deepEqual(
      scoped.outlets.slice().sort((a, b) => a.domain.localeCompare(b.domain)),
      [
        { domain: 'crusoe.com.br', lean: 'right', basis: 'third_party_consensus' },
        { domain: 'oantagonista.com.br', lean: 'right', basis: 'third_party_consensus' },
      ],
    )
    assert.ok(scoped.outlets.some((o) => o.domain === 'oantagonista.com.br' && o.basis === 'third_party_consensus'))
  })

  it('sourcesFor now filters by domain (regression) and annotates rows with lean/basis', async () => {
    const filtered = await sourcesFor(bolsonaro, { ...wideBase, domain: 'oantagonista.com.br' })
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].domain, 'oantagonista.com.br')
    assert.equal(filtered[0].lean, 'right')
    assert.equal(filtered[0].basis, 'third_party_consensus')

    const unfiltered = await sourcesFor(bolsonaro, wideBase)
    const exampleRow = unfiltered.find((r) => r.domain === 'example.org')
    assert.equal(exampleRow?.lean, null)
    assert.equal(exampleRow?.basis, null)
  })

  // risingSql is the one place the domain clause is duplicated, in recent_scope and again in
  // baseline_scope. Every other lean test only exercises the recent half; this one watches the
  // baseline half move. days:2250/baseline:100 puts "golpe" in the recent window via doc 21
  // (oantagonista.com.br, right) and in the baseline window via doc 42 (cartacapital.com.br,
  // left), so lean=right must drop the baseline hit while keeping the recent one.
  it('risingFor narrows count_baseline by lean, not only count_recent', async () => {
    const q: RisingQuery = { days: 2250, baseline: 100, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 100, min: 1 }

    const all = await risingFor(bolsonaro, q)
    const golpeAll = all.terms.find((t) => t.term === 'golpe')
    assert.equal(golpeAll?.count_baseline, 0.01, 'doc 42 must reach the baseline window when lean is unset')

    const right = await risingFor(bolsonaro, { ...q, lean: 'right' })
    const golpeRight = right.terms.find((t) => t.term === 'golpe')
    assert.ok(golpeRight, 'doc 21 keeps golpe in the recent window under lean=right')
    assert.equal(golpeRight?.count_baseline, 0, 'doc 42 is left-labeled, so lean=right must empty the baseline half')
  })

  // Amendment A1 on the spec: sourcesFor now honours q.domain, so the outlet sidebar — the
  // control that *picks* domain — must stop sending it, or clicking one outlet hides the rest.
  it('the outlet sidebar drops domain before fetching /sources (spec amendment A1)', () => {
    // Issue #37 gave this its own function in public/js/api.js, so the rule is now checked by
    // calling it rather than by slicing design-5.html's inline script.
    const opts = { days: '30', sort: 'count', limit: '18', source: 'all', domain: 'cartacapital.com.br' }
    assert.equal(sourcesParams(opts).has('domain'), false, '/sources must not echo back the domain the sidebar itself picks')
    assert.equal(params(opts).get('domain'), 'cartacapital.com.br', 'every other route still receives it')
  })

  it('timelineFor stays a bare array and still narrows by lean', async () => {
    const q: TimelineQuery = { term: '', kind: 'all', days: 2210, source: 'all', domain: 'all', lean: 'right', bucket: 'week' }
    const rows = await timelineFor(bolsonaro, q)
    assert.ok(Array.isArray(rows))
    assert.ok(!('outlets' in rows))
    assert.equal(rows.reduce((a, r) => a + r.count, 0), 1)

    const allLean = await timelineFor(bolsonaro, { ...q, lean: 'all' })
    assert.equal(allLean.reduce((a, r) => a + r.count, 0), 7)
  })
})
