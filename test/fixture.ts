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

export const docs: RawDoc[] = [
  { source: 'gnews', uri: 'https://g1.globo.com/1', text: 'Lula anuncia reforma tributária #reforma', publishedAt: day1, domain: 'g1.globo.com' },
  { source: 'bluesky', uri: 'at://did:plc:x/post/2', text: 'Lula e Tarcísio disputam a eleição', publishedAt: daysAgo(2), domain: 'ana.bsky.social' },
  { source: 'gnews', uri: 'https://folha.uol.com.br/3', text: 'Tarcísio inaugura rodovia no interior', publishedAt: daysAgo(3), domain: 'folha.uol.com.br', tone: -1.5 },
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
  // to reach termsSql/signatureSql's global `scope`, which counts every doc in the
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
  // termsSql/signatureSql's pmi formula, so every pinned pmi literal at those windows in
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

let ready: Promise<void> | null = null

export const seed = () =>
  (ready ??= (async () => {
    if (process.env.DATA_DIR !== 'memory://') throw new Error('tests must run with DATA_DIR=memory://')
    await migrate()
    await db.exec(`delete from doc_terms; delete from doc_persons; delete from docs; delete from persons;`)
    await upsertPersons(persons)
    for (const d of docs) await insertDoc(d, persons)
  })())
