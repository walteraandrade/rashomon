# Source research — 2026-09-08

Every candidate below was probed with `curl` on 2026-09-08, not read about. The
status column is the HTTP code and the number of `<item>` elements the feed
actually returned that day.

## Why look at all

The current `defaultSources` are `bluesky`, `rss`, `gnews`, `gkg`, `senado`,
`camara`. `rss` carries exactly two feeds (g1, Folha em cima da hora), so the
press side of the corpus is two outlets plus whatever Google News surfaces per
person.

The sharper gap is `seed.json`: of 27 people, 4 carry a `camaraId` and 2 a
`senadoId`. Roughly half are Supreme Court justices, whom the two official
collectors cannot reach at all. Nothing in the pipeline currently speaks legal
Portuguese.

## Working feeds

### Courts and legal press — covers the STF half of the seed

| Name | URL | Status |
|---|---|---|
| STF Notícias | `https://noticias.stf.jus.br/feed/` | 200, 10 items. `description` is empty; only the title carries text |
| Conjur | `https://www.conjur.com.br/rss.xml` | 200, 10 items, title + summary |
| JOTA | `https://www.jota.info/feed` | 200, 25 items |

### Official and institutional

| Name | URL | Status |
|---|---|---|
| Câmara Notícias — POLITICA | `https://www.camara.leg.br/noticias/rss/dinamico/POLITICA` | 200, 10 items, CDATA title + description |
| Câmara Notícias — ELEICOES | `https://www.camara.leg.br/noticias/rss/dinamico/ELEICOES` | 200, 10 items |
| Câmara Notícias — últimas | `https://www.camara.leg.br/noticias/rss/ultimas-noticias` | 200, 20 items |
| Agência Senado | `https://www12.senado.leg.br/noticias/rss` | 200, 15 items |
| Agência Brasil — Política | `https://agenciabrasil.ebc.com.br/rss/politica/feed.xml` | 200, 10 items |
| Planalto | `https://www.gov.br/planalto/pt-br/acompanhe-o-planalto/noticias/RSS` | 200, 25 items — RDF, not RSS 2.0; `rss.ts` reads `rss.channel.item` and would return zero |

The other Câmara topic feeds follow the same pattern:
`/noticias/rss/dinamico/{ADMINISTRACAO-PUBLICA,DIREITO-E-JUSTICA,ECONOMIA,...}`.

### General political press

| Name | URL | Status |
|---|---|---|
| G1 — Política | `https://g1.globo.com/dynamo/politica/rss2.xml` | 200, 100 items |
| Folha — Poder | `https://feeds.folha.uol.com.br/poder/rss091.xml` | 200, 100 items, ISO-8859-1 (the `decode` in `rss.ts` already handles it) |
| CNN Brasil | `https://www.cnnbrasil.com.br/feed/` | 200, 60 items |
| Poder360 | `https://www.poder360.com.br/feed/` | 200, 10 items |
| Congresso em Foco | `https://www.congressoemfoco.com.br/feed/` | 200, 20 items |
| Metrópoles | `https://www.metropoles.com/feed` | 200, 20 items |
| Veja | `https://veja.abril.com.br/politica/feed/` | 200, 20 items |
| Nexo | `https://www.nexojornal.com.br/rss.xml` | 200, 20 items |
| Piauí | `https://piaui.folha.uol.com.br/feed/` | 200, 30 items |
| UOL Notícias | `https://rss.uol.com.br/feed/noticias.xml` | 200, 15 items |

### Partisan and investigative — the ones that answer the product question

Two outlets describe the same person with different words. That divergence is
what the atlas exists to show, and no current source captures it.

| Lean | Name | URL | Status |
|---|---|---|---|
| left | Brasil de Fato | `https://www.brasildefato.com.br/feed` | 200, 99 items (`/rss2.xml` returns HTML) |
| left | Revista Fórum | `https://revistaforum.com.br/feed` | 200, 10 items |
| left | CartaCapital | `https://www.cartacapital.com.br/feed/` | 200, 20 items |
| right | Gazeta do Povo — República | `https://www.gazetadopovo.com.br/feed/rss/republica.xml` | 200, 56 items |
| right | O Antagonista | `https://oantagonista.com.br/feed/` | 200, 15 items |
| investigative | Intercept Brasil | `https://www.intercept.com.br/feed/` | 200, 40 items |
| investigative | Agência Pública | `https://apublica.org/feed/` | 200, 10 items |
| fact-check | Aos Fatos | `https://www.aosfatos.org/noticias/feed/` | 200, 20 items |
| fact-check | Lupa | `https://lupa.uol.com.br/feed` | 200, 10 items |

## Non-RSS APIs that answered

- **Wikipedia pageviews**, `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/pt.wikipedia/all-access/all-agents/{article}/daily/{start}/{end}` — 200, no key, needs a contact email header and one request per second. Returns attention, not text: it fits no existing column of `docs` and would be a new measure, not a new source.
- **Wikinews pt**, `https://pt.wikinews.org/w/api.php?action=query&list=search` — 200, but Brazilian volume is thin.
- **Mastodon**, `https://mastodon.social/api/v1/timelines/tag/{tag}` — 200 unauthenticated. A Brazilian instance refused with 422 (`This method requires an authenticated user`). Brazilian political volume on Mastodon is small.

## Rejected, with the reason

| Candidate | Result |
|---|---|
| Reddit (`/r/brasil/search.json`) | 403 without OAuth |
| TSE open data (`dadosabertos.tse.jus.br`) | 403, Akamai block |
| dados.gov.br CKAN API | 401, key required |
| Querido Diário | timed out at 25s, and municipal gazettes rarely name national figures |
| YouTube Data API | `captions.download` needs OAuth as the video owner |
| `public.api.bsky.app` searchPosts unauthenticated | 403, consistent with the pacing rule in `CLAUDE.md` |
| Estadão, R7, Band, Migalhas, STJ | 404 or dead feed |

## Two ways to add them

**A. Append URLs to the `feeds` array in `src/collectors/rss.ts`.** One line per
feed, no type change, no UI change. Cost: every outlet collapses into the single
source `rss`. The source filter cannot separate legal from partisan press, and
the press volume — roughly 500 items per ingest versus the current handful —
swamps Bluesky in the PMI ranking.

**B. Named collectors reusing `fetchFeed`** (`stf`/`juridico`, `oficial`,
`nicho`), each about five lines. Cost: `Source` in `src/types.ts`, the map in
`src/collectors/index.ts`, and the labels in `src/ui/format.ts:54` all have to
grow, and `docs/factory.md`'s one-issue-at-a-time rule still applies.

B is the only option that lets the interface show the divergence between
outlets, which is the point of the project.

## Risk to measure before merging, not after

Adding roughly 20 feeds multiplies the document count. `sort=pmi` orders by
`pmi * ln(1 + count)`, tuned against the current corpus size, and `CLAUDE.md`
forbids changing it without a test. Any change here needs a before/after on the
same person, not a green test suite alone.

# Second pass — 2026-09-09

The first pass asked which feeds answer. This one asks what a feed changes once
its docs are in the corpus, which is a different question with a different answer.

Method: the local corpus (38,885 docs) was copied, each candidate sampled, each
sample inserted into its own clone, and `graphFor` run before and after with
`sort=pmi`, `limit=20`. The number that matters is how many of a person's top 20
terms the sample displaces.

## What the corpus is made of

| Source | Docs | Avg text |
|---|---:|---:|
| `gkg` | 18,024 | 74 chars |
| `bluesky` | 14,083 | 155 |
| `gnews` | 5,287 | 165 |
| `rss` | 1,089 | 1,544 |
| `nicho` | 212 | 754 |
| `gdelt` | 106 | 72 |
| `juridico` | 45 | 251 |
| `oficial` | 32 | 1,592 |
| `camara` | 7 | 564 |

`gkg` and `bluesky` are 82% of it. Two things follow that are worth writing down:

- 4,297 docs (11%) are on `.pt` domains, all of them through `gkg`; `sapo.pt`
  alone is the second largest domain in the corpus, ahead of `uol.com.br`.
  Portuguese-from-Portugal vocabulary scores inside a Brazilian-politics graph.
- The `phrases` table is empty in the local database, so the collocation lexicon
  has never been built there and the `phrase` kind is effectively off.

## What each candidate displaces

| Sample | Docs | Names someone | Top-20 churn |
|---|---:|---:|---|
| g1 politics, full text | 100 | 89% | moraes 10/20, fachin 7/20 |
| eight other national feeds, headline only | 151 | ~55% | 0–1/20 |
| regional press via Google News `site:` | 5,203 | 66% | 2–5/20 |
| Câmara bill summaries (`/proposicoes`) | 381 | 100% | 2–7/20 |
| DOU (`in.gov.br` search payload) | 361 | 92% | 0/20 |

The control matters more than the ranking: g1's 100 full-text docs and the other
eight feeds' 151 headlines were sampled in the same run, and only the full text
moved anything. **More text per document beats more documents.**

Two corrections to the first pass's instincts:

- Regional press is not missing. All ten outlets probed are already in the corpus
  through `gkg` (`em.com.br` 546 docs, `otempo.com.br` 467, `correio24horas.com.br`
  250), just with a starved tail (`oliberal.com` 1, `campograndenews.com.br` 1).
  Adding 5,203 regional headlines displaced 2–5 terms of 20.
- DOU has the best hit rate of anything measured and changes nothing. Its new
  vocabulary is `caput`, `inciso`, `lotacao`, `atribuicao` — administrative
  boilerplate does not stick to a person.

Câmara bill summaries sit in between: real agenda words (`imposto seletivo`,
`sinarm`, `codigo de transito brasileiro`) mixed with legislative filler
(`arts`, `dispor`, `regimentais`, `requer`), and they only reach the 8 people
carrying a `camaraId`. Worth doing behind a stopword list, not before one.

Reddit was re-probed. `search.json` is still 403 on any User-Agent, but
`search.rss` answers 200 with 25 Atom entries — and rate-limits to two calls per
burst, 429 after that even at 12 s spacing. It is an Atom feed (`<entry>`), which
`rss.ts` cannot read: the parser reaches for `rss.channel.item`. A Reddit
collector needs OAuth (100 QPM free for personal use) and its own parser.

## What changed as a result

`src/collectors/rss.ts` now reads each outlet's politics section instead of its
front page. Only docs naming a tracked person get `doc_terms` rows, so a front
page spends most of its fetch on documents that can never contribute a term:

| Feed | Items | Naming someone | Avg text |
|---|---:|---:|---:|
| `g1.globo.com/rss/g1/` (was) | 100 | 18 | 2,607 |
| `g1.globo.com/rss/g1/politica/` (now) | 100 | 89 | 4,392 |
| `feeds.folha.uol.com.br/emcimadahora/` (was) | 100 | 26 | 375 |
| `feeds.folha.uol.com.br/poder/` (now) | 100 | 77 | 389 |

Same two requests per ingest, 44 usable docs before and 166 after, and the g1
half now carries the article body. `g1/mundo/` (2 of 100) and `g1/economia/`
(14 of 100) were measured and left out.
