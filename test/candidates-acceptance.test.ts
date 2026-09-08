import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { readFileSync } from 'node:fs'
import { db } from '../src/db.js'
import { capitalizedRuns, discoverNames } from '../src/extract.js'
import { candidatesFor } from '../src/graph.js'
import { parseCandidatesQuery } from '../src/query.js'
import { app } from '../src/server.js'
import { insertDoc } from '../src/store.js'
import { persons, seedCandidates } from './fixture.js'

// Acceptance tests for issue #32 (candidate queue), written from the issue text.

describe('AC1: capitalized runs that do not open a sentence', () => {
  it('finds runs of two or more capitalized words, particles allowed', () => {
    assert.deepEqual(capitalizedRuns('O ministro recebe Alexandre de Moraes e Hugo Motta hoje'), ['alexandre de moraes', 'hugo motta'])
  })

  it('drops a run that opens a sentence, in every sentence of the text', () => {
    assert.deepEqual(capitalizedRuns('Davi Alcolumbre fala com Rodrigo Pacheco. Rodrigo Pacheco responde'), ['rodrigo pacheco'])
    assert.deepEqual(capitalizedRuns('Senador Davi Alcolumbre: "Vamos votar" — disse Renan Calheiros'), ['renan calheiros'])
  })

  it('drops single capitalized words, hashtags, handles and urls', () => {
    assert.deepEqual(capitalizedRuns('Encontro com Lula e #HugoMotta @renan https://x.co/Renan Calheiros'), [])
  })

  it('a colon, quote or dash breaks a run but does not open a sentence', () => {
    assert.deepEqual(capitalizedRuns('STF: Alexandre de Moraes manda prender Jair Bolsonaro'), ['alexandre de moraes', 'jair bolsonaro'])
    assert.deepEqual(capitalizedRuns('Boa noite! Hoje no Jornal Nacional: Tarcísio de Freitas fala de São Paulo'), ['jornal nacional', 'tarcisio de freitas', 'sao paulo'])
  })

  it('breaks a run on commas and on "e"', () => {
    assert.deepEqual(capitalizedRuns('Reunião com Ciro Nogueira, Ciro Gomes e Renan Calheiros'), ['ciro nogueira', 'ciro gomes', 'renan calheiros'])
  })

  it('normalizes like aliases: lowercase, no accents, single spaces', () => {
    assert.deepEqual(capitalizedRuns('Encontro com   Cármen   Lúcia hoje'), ['carmen lucia'])
  })
})

describe('AC2: gkg uses the persons column, never the heuristic', () => {
  it('normalizes and dedupes the column names', () => {
    const names = discoverNames({ source: 'gkg', text: 'Fala com Renan Calheiros', extraNames: ['Hugo Motta', 'Hugo Motta', 'Cármen Lúcia'] }, [])
    assert.deepEqual(names, ['hugo motta', 'carmen lucia'])
  })

  it('yields nothing for a gkg doc without a persons column', () => {
    assert.deepEqual(discoverNames({ source: 'gkg', text: 'Fala com Renan Calheiros' }, []), [])
  })
})

describe('AC3: overlay with seed.json aliases and exclude entries', () => {
  const ciro = { id: 'ciro', name: 'Ciro Gomes', aliases: ['Ciro Gomes', 'Ciro'], exclude: ['Ciro Nogueira'] }

  it('drops a name equal to a tracked alias or exclude entry', () => {
    const names = discoverNames({ source: 'rss', text: 'Reunião com Ciro Nogueira, Ciro Gomes, Luiz Inácio e Renan Calheiros' }, [...persons, ciro])
    assert.deepEqual(names, ['renan calheiros'])
  })

  it('keeps a longer name that merely contains a tracked alias', () => {
    const names = discoverNames({ source: 'rss', text: 'Sessão com Michelle Bolsonaro hoje' }, persons)
    assert.deepEqual(names, ['michelle bolsonaro'])
  })

  it('applies the overlay to gkg column names too', () => {
    assert.deepEqual(discoverNames({ source: 'gkg', text: '', extraNames: ['Luiz Inacio', 'Hugo Motta'] }, persons), ['hugo motta'])
  })
})

describe('AC4: doc_candidates written by insertDoc', () => {
  before(seedCandidates)
  const stored = async (uri: string) =>
    (await db.query<{ name: string }>(`select c.name from doc_candidates c join docs d on d.id = c.doc_id where d.uri = $1 order by 1`, [uri])).rows.map((r) => r.name)

  it('stores the discovered names of a heuristic doc', async () => {
    assert.deepEqual(await stored('at://did:plc:x/post/c3'), ['hugo motta', 'renan calheiros'])
  })

  it('stores the column names of a gkg doc, overlay applied, text ignored', async () => {
    assert.deepEqual(await stored('https://folha.uol.com.br/c4'), ['hugo motta'])
  })

  it('does not rewrite candidates when the same uri arrives again', async () => {
    const again = await insertDoc({ source: 'rss', uri: 'https://example.org/c1', text: 'Outro texto com Renan Calheiros', publishedAt: new Date().toISOString() }, persons)
    assert.equal(again, false)
    assert.deepEqual(await stored('https://example.org/c1'), ['hugo motta'])
  })

  it('keeps the existing fixture docs free of candidates that match a tracked alias', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from doc_candidates where name in ('lula', 'tarcisio', 'bolsonaro', 'jair bolsonaro', 'luiz inacio')`)
    assert.equal(rows[0].n, 0)
  })
})

describe('AC5: GET /api/candidates', () => {
  before(seedCandidates)
  const get = async (qs = '') => {
    const res = await app.request(`/api/candidates${qs}`)
    assert.equal(res.status, 200)
    return res.json() as Promise<{ days: number; candidates: { name: string; count: number; sources: number; previous: number; samples: { id: number; source: string; text: string }[] }[] }>
  }

  it('defaults to days=7 min=5, which hides every fixture name (max count is 4)', async () => {
    const body = await get()
    assert.equal(body.days, 7)
    assert.deepEqual(body.candidates, [])
  })

  it('ranks by document count with count, distinct sources and the previous window', async () => {
    const { candidates } = await get('?min=2')
    assert.deepEqual(
      candidates.map(({ name, count, sources, previous }) => ({ name, count, sources, previous })),
      [
        { name: 'hugo motta', count: 4, sources: 4, previous: 0 },
        { name: 'renan calheiros', count: 2, sources: 2, previous: 2 },
      ],
    )
  })

  it('caps samples at three, newest first, with id, source and text only', async () => {
    const { candidates } = await get('?min=2')
    const hugo = candidates.find((c) => c.name === 'hugo motta')!
    assert.equal(hugo.samples.length, 3)
    assert.deepEqual(hugo.samples.map((s) => s.source), ['rss', 'gnews', 'gkg'])
    assert.deepEqual(Object.keys(hugo.samples[0]).sort(), ['id', 'source', 'text'])
    assert.equal(hugo.samples[0].text, 'O Senado ouve Hugo Motta sobre a reforma')
  })

  it('min=1 surfaces the single-doc names and limit trims the list', async () => {
    const all = await get('?min=1')
    assert.deepEqual(all.candidates.map((c) => c.name), ['hugo motta', 'renan calheiros', 'michelle bolsonaro', 'rodrigo pacheco'])
    const one = await get('?min=1&limit=1')
    assert.deepEqual(one.candidates.map((c) => c.name), ['hugo motta'])
  })

  it('a longer window moves the previous docs into the count', async () => {
    const { candidates } = await get('?days=14&min=2')
    const renan = candidates.find((c) => c.name === 'renan calheiros')!
    assert.equal(renan.count, 4)
    assert.equal(renan.previous, 0)
  })

  it('never lists a tracked alias', async () => {
    const { candidates } = await get('?days=365&min=1&limit=200')
    assert.ok(!candidates.some((c) => ['lula', 'luiz inacio', 'tarcisio', 'bolsonaro', 'jair bolsonaro'].includes(c.name)))
  })

  it('leaves the existing routes untouched', async () => {
    const people = await (await app.request('/api/people')).json() as { id: string }[]
    assert.deepEqual(people.map((p) => p.id).sort(), ['bolsonaro', 'lula', 'tarcisio'])
    const graph = await (await app.request('/api/people/lula/graph')).json() as { person: { id: string }; terms: unknown[] }
    assert.equal(graph.person.id, 'lula')
  })
})

describe('AC6: parameters clamped in src/query.ts', () => {
  it('uses 7 / 5 / 50 as defaults', () => {
    assert.deepEqual(parseCandidatesQuery({}), { days: 7, min: 5, limit: 50 })
  })

  it('clamps out-of-range and garbage values', () => {
    assert.deepEqual(parseCandidatesQuery({ days: '9999', min: '0', limit: '-3' }), { days: 365, min: 1, limit: 1 })
    assert.deepEqual(parseCandidatesQuery({ days: 'abc', min: '2000', limit: '999' }), { days: 7, min: 1000, limit: 200 })
  })
})

describe('candidatesFor direct call', () => {
  before(seedCandidates)
  it('returns the same shape as the route', async () => {
    const r = await candidatesFor({ days: 7, min: 2, limit: 10 })
    assert.equal(r.candidates[0].name, 'hugo motta')
  })
})

describe('AC7: "candidatos" list in the atlas (public/design-5.html)', () => {
  const html = readFileSync(new URL('../public/design-5.html', import.meta.url), 'utf8')

  it('has a candidates panel in the side column, before the inspector', () => {
    assert.match(html, /<details class="outlets candidates" id="candidateQueue">/)
    assert.ok(html.indexOf('id="candidateQueue"') < html.indexOf('id="inspector"'))
  })

  it('calls the route with the period select, min=3, and refreshes at boot and on days change', () => {
    assert.match(html, /\/api\/candidates\?days=\$\{\$\('days'\)\.value\}&min=3&limit=30/)
    assert.match(html, /if\(id==='days'\) loadCandidates\(\)/)
    assert.match(html, /loadCandidates\(\)\nload\(\)\s*\n<\/script>/)
  })

  it('renders name, docs, sources, trend and the sample docs on click, in pt-BR', () => {
    for (const s of ['Candidatos', "c.sources===1?'fonte':'fontes'", 'novo', 'Nenhum nome novo', 'data-candidate', 'aria-expanded', 'class="samples"']) assert.ok(html.includes(s), s)
  })
})
