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
