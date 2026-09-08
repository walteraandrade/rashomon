import { db, migrate } from '../src/db.js'
import { insertDoc, upsertPersons } from '../src/store.js'
import type { Person, RawDoc } from '../src/types.js'

export const persons: Person[] = [
  { id: 'lula', name: 'Lula', aliases: ['Lula', 'Luiz Inácio'] },
  { id: 'tarcisio', name: 'Tarcísio', aliases: ['Tarcísio', 'Tarcísio de Freitas'] },
  { id: 'bolsonaro', name: 'Bolsonaro', aliases: ['Bolsonaro', 'Jair Bolsonaro'] },
]

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

// day1 is shared by two docs on purpose: pagination must stay stable (no
// duplicate/skipped row) when published_at ties, per docsSql's id desc tiebreaker.
const day1 = daysAgo(1)

export const collidingUri = 'https://example.org/40'

export const docs: RawDoc[] = [
  { source: 'gnews', uri: 'https://g1.globo.com/1', text: 'Lula anuncia reforma tributária #reforma', publishedAt: day1, domain: 'g1.globo.com' },
  { source: 'bluesky', uri: 'at://did:plc:x/post/2', text: 'Lula e Tarcísio disputam a eleição', publishedAt: daysAgo(2), domain: 'ana.bsky.social' },
  { source: 'gkg', uri: 'https://folha.uol.com.br/3', text: 'Tarcísio inaugura rodovia no interior', publishedAt: daysAgo(3), domain: 'folha.uol.com.br', tone: -1.5 },
  { source: 'rss', uri: 'https://example.org/4', text: 'Congresso avança na pauta econômica', publishedAt: daysAgo(4), domain: 'example.org' },
  { source: 'gnews', uri: 'https://valor.globo.com/6', text: 'Lula defende reforma tributária', publishedAt: day1, domain: 'valor.globo.com' },
  { source: 'gnews', uri: 'https://g1.globo.com/5', text: 'Lula viaja para a Bahia', publishedAt: daysAgo(100), domain: 'g1.globo.com' },
  { source: 'rss', uri: 'https://example.org/7', text: 'Lula fala muito sobre reforma', publishedAt: daysAgo(1), domain: 'example.org' },
  // docs 8-13: two extra terms ("inflacao", "desemprego") that each hit 3 mentions,
  // dated past the 365-day ceiling so they only surface in wide-window signature tests.
  { source: 'rss', uri: 'https://example.org/8', text: 'Lula fala sobre a inflação persistente', publishedAt: daysAgo(400), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/9', text: 'Lula cita novamente a inflação alta', publishedAt: daysAgo(401), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/10', text: 'Lula reafirma compromisso com a inflação', publishedAt: daysAgo(402), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/11', text: 'Lula debate o desemprego crescente', publishedAt: daysAgo(410), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/12', text: 'Lula anuncia plano contra desemprego', publishedAt: daysAgo(411), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/13', text: 'Lula cobra combate ao desemprego total', publishedAt: daysAgo(412), domain: 'example.org' },
  // docs 14-16: three more terms ("educacao", "saude", "seguranca") that each hit 3
  // mentions and, unlike the pairs above, appear exclusively in about-lula docs, so
  // their pmi ties exactly with reforma/inflacao/desemprego's at a wide-enough window.
  // Dated well past every other days: window used in the suite (max 1000) so they
  // only surface when a test opts into an even wider window, verifying the signature
  // query's fixed limit-5 cap without disturbing any existing assertion.
  { source: 'rss', uri: 'https://example.org/14', text: 'Lula fala sobre educação, saúde e segurança no debate', publishedAt: daysAgo(1502), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/15', text: 'Lula defende educação, saúde e segurança para todos', publishedAt: daysAgo(1503), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/16', text: 'Lula prioriza educação, saúde e segurança no plano de governo', publishedAt: daysAgo(1504), domain: 'example.org' },
  // docs 17-19: "estabilidade fiscal" appears twice in a 31-50 day range, so it sits
  // outside the days:30 window used by the pre-existing graphFor/docsFor/sourcesFor
  // assertions but inside the days:365 ones, and inside risingFor's baseline window
  // at the default days:7/baseline:30 split — a term present only in the baseline,
  // which risingFor must exclude by construction (its recent count is zero).
  { source: 'rss', uri: 'https://example.org/17', text: 'Lula defende estabilidade fiscal para o país', publishedAt: daysAgo(31), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/18', text: 'Lula reforça a estabilidade fiscal em entrevista', publishedAt: daysAgo(35), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/19', text: 'Lula lembra a estabilidade fiscal conquistada', publishedAt: daysAgo(50), domain: 'example.org' },
  // docs 20-24: bolsonaro-only docs, all dated 2100+ days ago — well past the widest
  // window any existing test opens (graph.test.ts/signature.test.ts go up to days:2000
  // to reach the graph statement's global `scope`, which counts every doc in the
  // window regardless of person). Used by test/timeline.test.ts. Docs 20/21 sit in the
  // same 7-day span but on different calendar days (day-vs-week split); doc 22 is
  // isolated, leaving an empty week bucket between it and the 20/21 cluster; doc 23
  // sits near the oldest edge of a days:2140 window (exercises the bucket clamp,
  // since 2140 is not a multiple of 7); doc 24 has no "golpe" term and sits just past
  // that window (control, excluded by the window itself).
  { source: 'rss', uri: 'https://example.org/20', text: 'Bolsonaro nega qualquer participação em golpe de estado', publishedAt: daysAgo(2102), domain: 'example.org' },
  { source: 'gnews', uri: 'https://oantagonista.com.br/21', text: 'Bolsonaro é investigado por suposto golpe contra a democracia', publishedAt: daysAgo(2105), domain: 'oantagonista.com.br' },
  { source: 'rss', uri: 'https://example.org/22', text: 'Bolsonaro volta a falar sobre teorias de golpe militar', publishedAt: daysAgo(2116), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/23', text: 'Bolsonaro presta depoimento sobre planejamento de golpe', publishedAt: daysAgo(2139), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/24', text: 'Bolsonaro inaugura obra na região metropolitana', publishedAt: daysAgo(2150), domain: 'example.org' },
  // docs 30-32: three gdelt/estadao.com.br docs about Tarcísio inside the default 30-day
  // window, tones -2/-1/0 (avg -1, n=3) — the "meets the default min=3" fixture for
  // issue #5's tone-by-outlet matrix. "geopolitica" is used nowhere else in the fixture
  // so it cannot shift any pinned term-level pmi/count/tone assertion; adding these docs
  // to the days:30/365/1000/2000 scope does shift the person-agnostic n.total used by
  // the graph statement's pmi formula, so every pinned pmi literal at those windows in
  // graph.test.ts/signature.test.ts/signature-acceptance.test.ts was recomputed to match.
  { source: 'gdelt', uri: 'https://estadao.com.br/30', text: 'Tarcísio discute geopolítica durante evento internacional', publishedAt: daysAgo(6), domain: 'estadao.com.br', tone: -2 },
  { source: 'gdelt', uri: 'https://estadao.com.br/31', text: 'Tarcísio comenta geopolítica em entrevista à imprensa', publishedAt: daysAgo(7), domain: 'estadao.com.br', tone: -1 },
  { source: 'gdelt', uri: 'https://estadao.com.br/32', text: 'Tarcísio aborda geopolítica no fórum econômico', publishedAt: daysAgo(8), domain: 'estadao.com.br', tone: 0 },
  // docs 33-34: two gdelt/oglobo.globo.com docs about Tarcísio, tones 1/0.5 (n=2) — stays
  // below the default min=3, the "dropped below threshold" / "surfaces at min=2" fixture.
  { source: 'gdelt', uri: 'https://oglobo.globo.com/33', text: 'Tarcísio fala sobre commodities agrícolas na feira', publishedAt: daysAgo(9), domain: 'oglobo.globo.com', tone: 1 },
  { source: 'gdelt', uri: 'https://oglobo.globo.com/34', text: 'Tarcísio detalha exportação de commodities no porto', publishedAt: daysAgo(10), domain: 'oglobo.globo.com', tone: 0.5 },
  // doc 35: gdelt doc about Tarcísio with no domain — must never surface as a null/empty
  // entry in /api/tone's domains list, even though it carries a tone.
  { source: 'gdelt', uri: 'https://example.org/35', text: 'Tarcísio comenta infraestrutura portuária em evento fechado', publishedAt: daysAgo(11), tone: -3 },
  // doc 36: untoned rss doc, same domain/person/window as docs 30-32, proving toneSql's
  // count(d.tone)/avg(d.tone) truly skip null tone instead of a count(*)/coalesce rewrite that
  // would silently inflate the estadao.com.br cell to n=4. Words distinct from every other
  // fixture doc so it cannot shift any pinned term-level pmi/count/tone assertion.
  { source: 'rss', uri: 'https://estadao.com.br/36', text: 'Tarcísio recebe embaixadores em cerimônia diplomática', publishedAt: daysAgo(7), domain: 'estadao.com.br' },
  // doc 37: single gdelt doc naming both Tarcísio and Bolsonaro, toned — the "doc mentioning
  // two tracked persons contributes to both persons' groups" edge case from the spec.
  // Deliberately: (a) avoids Lula, kept at zero toned docs anywhere for the existing "person
  // without toned docs" fixture; (b) sits at day 35, just outside the default 30-day window, so
  // bolsonaro's "zero docs in the default window" timeline fixture (all other bolsonaro docs are
  // 2100+ days old) stays intact; (c) avoids "golpe", bolsonaro's pinned timeline term. It still
  // falls inside the wider 365/1000/2000-day windows, so pinned pmi/stats literals for lula at
  // those windows were recomputed (n.total only — the doc names neither lula nor a lula term).
  { source: 'gdelt', uri: 'https://poder360.com.br/37', text: 'Tarcísio e Bolsonaro debatem aliança para o pleito em reunião reservada', publishedAt: daysAgo(35), domain: 'poder360.com.br', tone: 0.4 },
  // doc 38: gkg doc about lula, day1 (in the default 30-day window), toned 0.6 — issue #8's
  // press-vs-network fixture. Words ("assina", "parceria", "estrangeira", "expandir", "setor",
  // "tecnologico") are unique across the whole fixture, so it only adds new lula terms at
  // count 1 (below every existing min threshold used by pinned tests) and widens n.total,
  // stats.docs/about and every pmi literal computed at a window covering day1, which were
  // recomputed to match.
  { source: 'gkg', uri: 'https://gdeltproject.org/38', text: 'Lula assina parceria estrangeira para expandir setor tecnológico', publishedAt: day1, domain: 'gdeltproject.org', tone: 0.6 },
  // same uri from rss then gkg, far outside every window the other suites use:
  // the rss row wins and must never pick up the gkg tone.
  { source: 'rss', uri: collidingUri, text: 'Tarcísio anuncia obra em Santos', publishedAt: daysAgo(3000), domain: 'example.org' },
  { source: 'gkg', uri: collidingUri, text: 'Tarcísio anuncia obra em Santos', publishedAt: daysAgo(3000), domain: 'example.org', tone: -3.2 },
  // doc 39: camara doc about bolsonaro, dated daysAgo(3000) like collidingUri — outside every
  // window any existing suite opens, so no pinned pmi/stats/tone/timeline literal needs
  // recomputing. Text follows the collector's own "{name}: {sumario}" convention (issue #24),
  // vocabulary unused elsewhere in the fixture.
  { source: 'camara', uri: 'https://www.camara.leg.br/discursos/74847/2018-01-01T10:00', text: 'Jair Bolsonaro: discute segurança pública e cooperação federativa em pronunciamento na tribuna', publishedAt: daysAgo(3000), domain: 'camara.leg.br' },
  // doc 40: a senado pronouncement (issue #25), dated well past every window any pinned literal
  // in this suite reaches (the widest is timeline.test.ts's days:2151), and with vocabulary
  // ("soberania", "infraestrutura", "portuaria") unique across the fixture, so no pinned
  // pmi/count/tone/stats literal shifts. Untoned by construction (senado is not in
  // tonedSources). It names "Davi Alcolumbre" as a name-prefix, not one of this fixture's three
  // tracked persons (lula/tarcisio/bolsonaro), so it stores with zero doc_persons rows here on
  // purpose -- person-tagging via the name-prefix convention is proven independently against the
  // full seed.json in test/extract.test.ts, and against a locally-tracked "alcolumbre" person in
  // test/store.test.ts and test/graph.test.ts, without perturbing this fixture's pinned
  // `/api/tone` persons.length===3 assertions.
  { source: 'senado', uri: 'https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/999999', text: 'Davi Alcolumbre: pronunciamento sobre soberania nacional e infraestrutura portuária', publishedAt: daysAgo(3200), domain: 'senado.leg.br' },
  // doc 41: bolsonaro doc on a left-labeled outlet (outlets.json), dated past every window any
  // existing pinned test opens (widest is days:2151 in timeline.test.ts AC5), so it only surfaces
  // in new lean-filtering tests that deliberately open a wider window (e.g. days:2210) and never
  // shifts n.total or any existing pmi/count/tone literal elsewhere. Together with doc 21
  // (oantagonista.com.br, right, day 2105), doc 37 (poder360.com.br, center, day 35) and the
  // example.org docs (absent from outlets.json), this gives three differently-labeled/unlabeled
  // domains about bolsonaro reachable in one wide window for issue #26's lean tests.
  { source: 'gnews', uri: 'https://cartacapital.com.br/41', text: 'Bolsonaro concede entrevista a veículo de esquerda sobre pauta econômica', publishedAt: daysAgo(2200), domain: 'cartacapital.com.br' },
  // doc 42: same left-labeled outlet as doc 41 but at day 2300, past every window any other
  // test opens (widest reaching it would be lean.test.ts's own days:2250 rising case; the
  // days:3100/3300 windows elsewhere are scoped to alcolumbre or source='senado'). It reuses
  // "golpe", which docs 20-23 already put in the recent window, so a rising query can watch the
  // *baseline* half of risingSql honour a lean filter — the one clause the spec warns is
  // duplicated across recent_scope and baseline_scope.
  { source: 'gnews', uri: 'https://cartacapital.com.br/42', text: 'Bolsonaro rebate acusações de golpe em artigo de opinião', publishedAt: daysAgo(2300), domain: 'cartacapital.com.br' },
  // docs 43-45: the cases a careless count(distinct doc_id) -> count(*) rewrite breaks (issue
  // #47). Dated 3400+ days ago, past the widest window any other suite opens (3300, in
  // test/senado-independent-acceptance.test.ts and test/graph.test.ts), so no pinned
  // pmi/count/tone/stats literal anywhere shifts; the issue #47 suite opens days:3500 on
  // purpose to reach them. "coalizao" appears nowhere else in the fixture.
  //
  // Doc 43 names *two* tracked persons and doc 44/45 one each, so the term_all/tracked
  // universe must count doc 43 once: a `tracked` built by joining doc_persons instead of the
  // current `exists` would double it under count(*) and stay right under count(distinct).
  // All three carry "coalizao" as a hashtag, as a word and (43/44) as a theme extra term, so
  // the same term text lives under several kinds on one doc — the case that must stay three
  // separate nodes with their own counts, and that gives linksSql a same-text pair
  // co-occurring in exactly two docs (43 and 44), one of them the shared one.
  { source: 'rss', uri: 'https://example.org/43', text: 'Lula e Bolsonaro discutem #coalizao e coalizao no plenário', publishedAt: daysAgo(3400), domain: 'example.org', extraTerms: [{ term: 'coalizao', kind: 'theme' }] },
  { source: 'rss', uri: 'https://example.org/44', text: 'Lula defende #coalizao e coalizao ampla no plenário', publishedAt: daysAgo(3401), domain: 'example.org', extraTerms: [{ term: 'coalizao', kind: 'theme' }] },
  { source: 'rss', uri: 'https://example.org/45', text: 'Bolsonaro rejeita #coalizao e coalizao estreita', publishedAt: daysAgo(3402), domain: 'example.org' },
  // docs 46-48: one fixture doc per new press family (issue #72), dated 3500+ days ago — past
  // the widest window any pinned literal elsewhere in the suite reaches (3400, docs 43-45
  // above) — with vocabulary ("desembargador", "inelegibilidade", "auditoria", "manifestacao",
  // "editorial") unused elsewhere in the fixture, so no pinned pmi/count/tone/stats literal
  // shifts. Untoned by construction (juridico/oficial/nicho are not in tonedSources).
  { source: 'juridico', uri: 'https://noticias.stf.jus.br/46', text: 'Jair Bolsonaro: desembargador nega recurso em julgamento sobre inelegibilidade', publishedAt: daysAgo(3500), domain: 'noticias.stf.jus.br' },
  { source: 'oficial', uri: 'https://agenciabrasil.ebc.com.br/47', text: 'Lula participa de auditoria sobre concessao de rodovias federais', publishedAt: daysAgo(3501), domain: 'agenciabrasil.ebc.com.br' },
  // cartacapital.com.br is already left-labeled in outlets.json (see doc 41), so this doubles
  // as a lean+family combination fixture without needing new outlets.json entries.
  { source: 'nicho', uri: 'https://cartacapital.com.br/48', text: 'Bolsonaro é alvo de manifestacao e editorial critico em veiculo de esquerda', publishedAt: daysAgo(3502), domain: 'cartacapital.com.br' },
]

// Kept out of `docs`/`seed()` on purpose: scopeCte has no upper bound on published_at, so a
// future-dated doc is picked up by `scope` (person-agnostic) for *any* days/source/domain='all'
// query, which would shift the hardcoded pmi/stats.docs numbers in graph.test.ts and
// signature*.test.ts regardless of which person or term it uses. Node's test runner spawns one
// process per test file, so test/timeline-future.test.ts seeds this on top of the normal
// fixture in its own isolated database, exercising the open-ended newest bucket without
// touching any other suite.
export const futureDoc: RawDoc = {
  source: 'rss',
  uri: 'https://example.org/26',
  text: 'Bolsonaro comenta golpe em entrevista antecipada',
  publishedAt: daysAgo(-1),
  domain: 'example.org',
}

// Candidate-queue docs (issue #32). Kept out of `docs`/`seed()` like futureDoc: they must sit
// inside the default 7-day window and its previous window (days 8-14), which is also inside
// every pinned pmi/stats window in graph.test.ts and signature*.test.ts, so seeding them in
// the shared fixture would shift n.total there. test/candidates-acceptance.test.ts layers
// them on top of the normal fixture in its own isolated database via seedCandidates().
// "Hugo Motta" appears in 4 docs across 4 sources (rss, gnews, bluesky, gkg) in the recent
// window and 0 in the previous one; "Renan Calheiros" in 2 recent docs (bluesky, rss) and 2
// previous (rss). The gkg doc carries a persons column (extraNames) whose "Luiz Inacio" is
// an alias of the tracked lula, and whose text names Renan Calheiros, which must NOT be
// discovered from a gkg doc (gkg uses the column, not the heuristic).
export const candidateDocs: RawDoc[] = [
  { source: 'rss', uri: 'https://example.org/c1', text: 'O Senado ouve Hugo Motta sobre a reforma', publishedAt: daysAgo(1), domain: 'example.org' },
  { source: 'gnews', uri: 'https://g1.globo.com/c2', text: 'Deputados apoiam Hugo Motta na votação', publishedAt: daysAgo(2), domain: 'g1.globo.com' },
  { source: 'bluesky', uri: 'at://did:plc:x/post/c3', text: 'Encontro reúne Hugo Motta e Renan Calheiros', publishedAt: daysAgo(3), domain: 'ana.bsky.social' },
  { source: 'gkg', uri: 'https://folha.uol.com.br/c4', text: 'Presidente da Câmara recebe Renan Calheiros', publishedAt: daysAgo(2.5), domain: 'folha.uol.com.br', tone: 0.2, extraNames: ['Hugo Motta', 'Luiz Inacio'] },
  { source: 'rss', uri: 'https://example.org/c5', text: 'Análise cita Renan Calheiros e a reforma', publishedAt: daysAgo(4), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/c6', text: 'Bastidores mostram Renan Calheiros na articulação', publishedAt: daysAgo(10), domain: 'example.org' },
  { source: 'rss', uri: 'https://example.org/c7', text: 'Entrevista com Renan Calheiros sobre o Senado', publishedAt: daysAgo(12), domain: 'example.org' },
  // alias overlay: "Luiz Inácio" is lula's alias, so only Michelle surfaces (count 1).
  { source: 'rss', uri: 'https://example.org/c8', text: 'Sessão com Luiz Inácio e Michelle Bolsonaro', publishedAt: daysAgo(1), domain: 'example.org' },
  // "Davi Alcolumbre" opens the sentence (dropped); "Rodrigo Pacheco" is found once, from the
  // first sentence only, since it opens the second one.
  { source: 'rss', uri: 'https://example.org/c9', text: 'Davi Alcolumbre fala com Rodrigo Pacheco. Rodrigo Pacheco responde', publishedAt: daysAgo(1), domain: 'example.org' },
]

export const seedCandidates = async () => {
  await seed()
  for (const d of candidateDocs) await insertDoc(d, persons)
}

// doc_id is not known ahead of time (docs get a serial id on insert), so this resolves
// uri -> doc_id at seed time rather than hardcoding it.
export const insertTestimony = async (uri: string, personId: string, method: string, score: number | null) => {
  const { rows } = await db.query<{ id: number }>(`select id from docs where uri = $1`, [uri])
  await db.query(`insert into doc_testimony (doc_id, person_id, method, score) values ($1, $2, $3, $4)`, [
    rows[0].id,
    personId,
    method,
    score,
  ])
}

// Testimony rows for issue #21's /testimony route, layered on top of the existing docs
// 30-38/1/5/37 rather than adding new docs, per the researcher brief: their tone/domain/
// cross-person shapes already match what testimony needs.
export const seedTestimony = async () => {
  await insertTestimony('https://estadao.com.br/30', 'tarcisio', 'stub', 4)
  await insertTestimony('https://estadao.com.br/31', 'tarcisio', 'stub', 6)
  await insertTestimony('https://estadao.com.br/32', 'tarcisio', 'stub', 2)
  await insertTestimony('https://oglobo.globo.com/33', 'tarcisio', 'stub', 5)
  await insertTestimony('https://oglobo.globo.com/34', 'tarcisio', 'stub', -1)
  await insertTestimony('https://example.org/35', 'tarcisio', 'stub', -8)
  await insertTestimony('https://estadao.com.br/36', 'tarcisio', 'stub', null)
  await insertTestimony('https://poder360.com.br/37', 'tarcisio', 'stub', 7)
  await insertTestimony('https://poder360.com.br/37', 'bolsonaro', 'stub', -7)
  await insertTestimony('https://g1.globo.com/1', 'lula', 'stub', 6)
  await insertTestimony('https://gdeltproject.org/38', 'lula', 'stub', 3)
  await insertTestimony('https://g1.globo.com/5', 'lula', 'stub', -2)
}

// Metadata enrichment pair (issue #50): the same uri arrives first from a collector that knows
// no domain and then from one that does, so the second arrival must fill `domain` and nothing
// else. Kept out of `docs`/`seed()` like futureDoc: another doc inside the windows the pinned
// pmi/stats literals use would shift every one of them.
export const enrichmentDocs: RawDoc[] = [
  { source: 'gnews', uri: 'https://example.org/enrich', text: 'Lula comenta a pauta do congresso', publishedAt: daysAgo(3400) },
  { source: 'gnews', uri: 'https://example.org/enrich', text: 'Lula comenta a pauta do congresso', publishedAt: daysAgo(3400), domain: 'example.org' },
]

// A person the persons table never received: doc_persons.person_id has a foreign key, so a doc
// naming this one fails *after* its docs row was written, which is exactly the failure the
// write path must not leave half applied. It takes an id because node:test runs one process
// per file: a suite that repairs the failure by upserting the person would otherwise disarm
// the next suite in the same file.
export const untrackedPerson = (id = 'nao-cadastrado'): Person => ({ id, name: 'Ciro Gomes', aliases: ['Ciro Gomes'] })

// The write-path suites need three readers the fixture had no equivalent for: whether an upsert
// wrote a new row version at all, what a single doc carries in the derived tables, and the whole
// derived state as a comparable value.
export const rowVersion = async (uri: string) =>
  (await db.query<{ v: string }>(`select xmin::text as v from docs where uri = $1`, [uri])).rows[0]?.v ?? null

export const derivedCounts = async (uri: string) =>
  (
    await db.query<{ persons: number; terms: number; candidates: number }>(
      `select
         (select count(*) from doc_persons p where p.doc_id = d.id)::int as persons,
         (select count(*) from doc_terms t where t.doc_id = d.id)::int as terms,
         (select count(*) from doc_candidates c where c.doc_id = d.id)::int as candidates
       from docs d where d.uri = $1`,
      [uri],
    )
  ).rows[0] ?? null

export const derivedRows = async () => ({
  persons: (await db.query<{ k: string }>(`select doc_id || ':' || person_id as k from doc_persons order by 1`)).rows.map((r) => r.k),
  terms: (await db.query<{ k: string }>(`select doc_id || ':' || kind || ':' || term as k from doc_terms order by 1`)).rows.map((r) => r.k),
  candidates: (await db.query<{ k: string }>(`select doc_id || ':' || name as k from doc_candidates order by 1`)).rows.map((r) => r.k),
})

// doc_terms exists only for docs naming at least one tracked person (issue #52); these two
// are shared by the store and reindex suites, which assert that invariant from both sides.
export const orphanTermCount = async () =>
  (await db.query<{ n: number }>(`select count(*)::int as n from doc_terms t where not exists (select 1 from doc_persons p where p.doc_id = t.doc_id)`)).rows[0].n

export const termsOf = async (uri: string) =>
  (await db.query<{ term: string }>(`select t.term from doc_terms t join docs d on d.id = t.doc_id where d.uri = $1 order by 1`, [uri])).rows.map((r) => r.term)

let ready: Promise<void> | null = null

export const seed = () =>
  (ready ??= (async () => {
    if (process.env.DATA_DIR !== 'memory://') throw new Error('tests must run with DATA_DIR=memory://')
    await migrate()
    await db.exec(`delete from doc_terms; delete from doc_persons; delete from docs; delete from persons;`)
    await upsertPersons(persons)
    for (const d of docs) await insertDoc(d, persons)
    await seedTestimony()
  })())

// Schema introspection, shared by the index/maintenance suites: pg_indexes is the only place
// the shape migrate() actually produced can be read back, rather than re-asserting its source.
export const indexDefs = async (table: string) =>
  (
    await db.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = $1 order by indexname`,
      [table],
    )
  ).rows

// reltuples is -1 until a table is analyzed and the planner's row estimate after, so it is the
// cheapest observable proof that a targeted `analyze` actually ran on that table.
export const planRowEstimate = async (table: string) =>
  (await db.query<{ reltuples: number }>(`select reltuples from pg_class where relname = $1`, [table])).rows[0].reltuples

export const lastAnalyzed = async (table: string) =>
  (await db.query<{ at: Date | null }>(`select last_analyze as at from pg_stat_user_tables where relname = $1`, [table])).rows[0]?.at ?? null
