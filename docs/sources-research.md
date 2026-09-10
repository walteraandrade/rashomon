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

# Third pass — 2026-09-10

The question was whether fetching the article body of documents already stored would
improve the graph enough to justify building a collector for it. It would, and then a
cheaper path with no legal question turned out to give almost the same result.

## The scraping experiment, and why it was abandoned

258 pages were fetched on a copy of the corpus and their text replaced in place. Four
extractors were compared over the same raw HTML, "ok" meaning 800–40 000 characters:
a naive `<p>` regex 210/258 (42 of them the whole home page), a dependency-free
extractor 173, cheerio 179, jsdom + Readability **247**. cheerio bought six documents
over the dependency-free version at 55x the time, so it was never a middle option.

Replacing 342 bodies took the average document from 128 to 3553 characters, 28x, and
moved Moraes's PMI top-20 by 14 of 20 — the same order as the 2026-09-09 g1 result.
`doc_persons` grew by 970 rows: bodies name people the headline never did.

Three corrections to the assumptions that started it: `bluesky` cannot be enriched at
all (10 291 documents naming someone, zero http uris — a post *is* the text); only
1087 of `gkg`'s 18 024 documents name a tracked person; and Google News redirects are
77% of the fetchable pool, not 24%. Those redirects need a `batchexecute` POST, which
resolved 106/106 at two requests each.

**Abandoned anyway.** Storing article bodies is a copy, and publisher terms of use
forbid it. `/api/people/:id/docs` and `/api/candidates` both serve `docs.text` in
public, so it would also have been republication. Discarding the body after deriving
was not a way out either: `reindexAll` truncates the derived tables and rebuilds from
`docs.text`, so the enrichment would evaporate at the next `pnpm reindex`.

## What replaced it: `content:encoded`

`toDoc` read `item.description` and never `content:encoded`, the element a publisher
uses to syndicate the whole article on purpose. Nine of the eighteen feeds already
collected fill it:

| feed | description | content:encoded | gain |
|---|---|---|---|
| apublica.org | 160 | 9984 | 62x |
| noticias.stf.jus.br | 118 | 4056 | 34x |
| jota.info | 185 | 5491 | 30x |
| intercept.com.br | 401 | 11813 | 30x |
| lupa.uol.com.br | 190 | 4042 | 21x |
| camara.leg.br (ELEICOES) | 184 | 3451 | 19x |
| camara.leg.br (POLITICA) | 175 | 2879 | 17x |
| conjur.com.br | 542 | 8183 | 15x |
| revistaforum.com.br | 404 | 6169 | 15x |

`jota.info` blocked 5 of 5 pages when scraped and `intercept.com.br` returned 403.
Both hand the whole article over in their own feed.

Six more feeds fill it and were added to `rss` for that reason: `osul.com.br` (399
items per fetch, 3238 chars), `cnnbrasil.com.br` (60, 2877), `correiobraziliense`
(30, 4482), `metropoles.com` (20, 5436), `veja.abril.com.br` (20, 3035),
`poder360.com.br` (10, 3032). Four of the six are the outlet's whole site, which the
second pass argued against; the fourth pass below is the check of whether each of them
has a politics section to read instead. These do not fill it: g1, Folha, Brasil de
Fato, CartaCapital, Gazeta do Povo, O Antagonista, Aos Fatos, Nexo, Piauí, BBC,
Congresso em Foco, Agência Brasil, Senado. g1 is the one exception worth naming: its
politics feed puts the whole article in `description` instead (4491 chars an item on
2026-09-10), and `body()` prefers whichever of the two is longer.

## Measured against a clean copy

One fetch of those fifteen feeds yields 670 full-text documents, 323 naming a tracked
person, 4921 characters average. Inserted with `insertDocs`: 593 new, 77 already
known by uri, 3.6s.

| person | scraping 342 bodies | one full-text fetch |
|---|---|---|
| moraes | 14/20 | 13/20 |
| fachin | 10/20 | 9/20 |
| lula | 3/20 | 5/20 |
| bolsonaro | 6/20 | 5/20 |
| haddad | 5/20 | 2/20 |
| tarcisio | 4/20 | 1/20 |

Moraes's incoming terms are almost the identical set — `supremo tribunal federal`,
`daniel vorcaro`, `banco master`, `andre mendonca`, `policia federal`,
`andrei rodrigues`, `paulo gonet`, `edson fachin`, `banqueiro` — and the same
truncation garbage leaves: `mend(11)`, `gonet(24)`, `cristiano(101)`, `zanin(110)`.
Full text spells names whole, so the phrase rule replaces half-names with real ones.

Syndicated text is also cleaner than scraped text: `Foto:` appears in 6 of 323
documents against 45 of 105 when scraped, and `foto` never reaches a top-20.
Readability cannot separate a photo credit from a sentence; a publisher's feed never
included one.

## Two defects this exposed

`upsertDoc` never updated `text`, so 77 of the 670 documents kept their headline and
the article was discarded. It now keeps the longer of the two and re-derives that
document's terms.

Body text carries filler a headline never did — `feira=193 segundo=193 dois=155
alem=122 durante=116` by document frequency, and `setembro` at rank 6 in Lula's
atlas. Nineteen words were added to `stopwords`; five obvious neighbours were left
out because a stopword also forbids a phrase. See
[terms.md](terms.md#stopwords-and-full-text).

## End to end, on a copy of the corpus

`pnpm ingest rss juridico oficial nicho` against a copy of `data/pg`:

```
[rss] fetched 740, new 731, enriched 1
[juridico] fetched 45, new 36, enriched 8
[oficial] fetched 45, new 15, enriched 20
[nicho] fetched 321, new 161, enriched 73
total docs: 39828
```

943 new documents, 102 of them documents that already existed as a headline and were
replaced by the article. Moraes's top-20 afterwards, from that one run: `edson
fachin, supremo tribunal federal, daniel vorcaro, andre mendonca, supremo, banco
master, policia federal, andrei rodrigues, mensagens, paulo gonet, relatorio, relator,
ministros, conducao, retirou, investigacoes, inquerito, banqueiro, improbidade,
procedimento`.

The new stopwords only reach documents derived after them: `setembro` was still ranked
12th for Lula on 257 documents that had stored it earlier. `pnpm reindex` is what makes
the set retroactive.

## Still unmeasured

Whether a feed keeps filling `content:encoded` over time. `pnpm ingest` now prints
`enriched` per source, which is the signal that would fall to zero first.

# Fourth pass — 2026-09-10

The third pass added four whole-site feeds, which is what the second pass argued
against: a front page spends most of its items on people nobody tracks. Each of the
four was checked for a politics section that fills `content:encoded`. None has one, so
all four stay whole-site on purpose rather than by omission.

| Outlet | Paths tried | Result |
|---|---|---|
| `cnnbrasil.com.br` | `/politica/feed/`, `/politica/feed`, `/rss/politica`, `/tag/politica/feed/`, `/category/politica/feed/`, `/feed/?cat=politica` | 404 or the whole-site feed unchanged; the politics page declares no `<link rel="alternate" type="application/rss+xml">` (it renders client-side). Politics and eleições are 19 of the site feed's 60 items, the largest single slice. |
| `metropoles.com` | `/politica/feed`, `/tag/politica/feed`, `/category/politica/feed`, `/brasil/feed`, `/distrito-federal/politica-df/feed` | All answer, and none carries the article: `content:encoded` averages 121–126 chars on every one of them, against 2933 on `/feed`. `/politica/feed` is the stale Blog do Noblat (last item July 2025) and `/distrito-federal/politica-df/feed` is years old. Swapping any of them in would throw away the full text this pass exists for. |
| `poder360.com.br` | `/poder-politica/feed/`, `/categoria/poder-politica/feed/`, `/tag/politica/feed/`, `/feed/politica` | The politics page declares only `/feed/`. `/tag/politica/feed/` is a real, distinct feed but a hand-tagged subset, 10 items over four days at 2139 chars against the site feed's 3616. It costs coverage and text for nothing: every item of the site feed is under a `poder-*` section (`poder-justica`, `poder-governo`, `poder-economia`, `poder-eleicoes-2026`) — the outlet publishes politics and nothing else. |
| `osul.com.br` | `/politica/feed/`, `/categoria/politica/feed/`, `/tag/politica/feed/`, `/noticias/politica/feed/`, `/feed/?cat=politica` | `/politica/feed/` is an empty WordPress *comments* feed ("Comentários sobre:", zero items); every other path serves the same 400-item whole-site feed. The site page declares no alternate feed. This is the noisiest of the four (celebrities and sport sit next to politics), and there is no narrower feed to read. |

`veja.abril.com.br/politica/feed/` (2788 chars an item) and
`correiobraziliense.com.br/rss/noticia/politica/rss.xml` (4538) already point at a
politics section and were left alone.

# Fifth pass — 2026-09-10

How long a stored document gets, per source, on the local corpus (39.8k docs), before any cap
existed. `length(text)` in characters; `p99` is `percentile_cont(0.99)`.

| Source | Docs | p50 | p99 | Max |
|---|---|---|---|---|
| `rss` | 1089 | 595 | 7942 | 20001 |
| `oficial` | 32 | 252 | 5937 | 6169 |
| `nicho` | 212 | 372 | 5228 | 16505 |
| `camara` | 7 | 609 | 707 | 710 |
| `juridico` | 45 | 190 | 623 | 640 |
| `gnews` | 5287 | 156 | 389 | 930 |
| `bluesky` | 14083 | 139 | 300 | 308 |
| `gkg` | 18024 | 72 | 129 | 212 |
| `gdelt` | 106 | 70 | 123 | 131 |

Only the three feed sources that fill `content:encoded` ever pass 5k characters (`rss` 59
docs, `nicho` 3, `oficial` 3), and only six documents pass 10k: g1 debate transcripts and two
aosfatos explainers. The longest, at 20001, ends on a complete sentence, so it was not cut by
the publisher either. `MAX_DOC_CHARS` in `src/store.ts` stays at the proposed 20 000: 2.5x the
worst p99, and on this corpus it touches exactly one document, by a handful of characters.
