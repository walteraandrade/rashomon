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
]

let ready: Promise<void> | null = null

export const seed = () =>
  (ready ??= (async () => {
    if (process.env.DATA_DIR !== 'memory://') throw new Error('tests must run with DATA_DIR=memory://')
    await migrate()
    await db.exec(`delete from doc_terms; delete from doc_persons; delete from docs; delete from persons;`)
    await upsertPersons(persons)
    for (const d of docs) await insertDoc(d, persons)
  })())
