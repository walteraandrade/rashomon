# Sources

One collector per source in `src/collectors/*`, all sharing the same `Collector` signature. `pnpm ingest` runs the default set; `pnpm ingest gkg` runs one of them. `pnpm purge <source>` deletes that source's docs (and resets `gkg_files` for `gkg`), for a clean re-fetch.

| Source | What it collects | On by default |
| --- | --- | --- |
| `bluesky` | posts mentioning each tracked person | yes |
| `gnews` | Google News RSS search per person, Brazil, pt-BR | yes |
| `rss` | g1 and Folha, politics sections | yes |
| `gkg` | GDELT GKG translation files, Portuguese rows | yes |
| `senado` | plenary speech summaries of tracked senators | yes |
| `camara` | floor-speech summaries of tracked deputies | yes |
| `juridico` | courts and legal press feeds | yes |
| `oficial` | institutional press feeds | yes |
| `nicho` | partisan, investigative and fact-check press feeds | yes |
| `gdelt` | GDELT DOC API | no, rate limited |

Only `gkg` and `gdelt` carry tone. Every other source stores `tone = null`; see [domain and tone](terms.md#domain-and-tone).

## Per collector

Bluesky without login returns one page (100 posts) per person. To paginate, set `BSKY_HANDLE` and `BSKY_APP_PASSWORD` (app password, not the account password).

`rss` reads eight feeds. g1 and Folha are the outlet's politics section rather than its front page: only docs naming a tracked person get `doc_terms` rows ([terms](terms.md)), so a front page spends most of its items on nobody — measured on 2026-09-09, g1's front page named someone tracked in 18 of 100 items against the politics feed's 89, and Folha's `emcimadahora` in 26 against `poder`'s 77. g1's politics feed also carries the article body (4392 chars an item, against the front page's 2607 and Folha's 389), which is why `rss` averages an order of magnitude more text per doc than `gkg` or `bluesky`.

`veja.abril.com.br` and `correiobraziliense.com.br` are politics sections for the same reason. `cnnbrasil.com.br`, `metropoles.com`, `poder360.com.br` and `osul.com.br` are the outlet's whole site because that outlet publishes no politics feed at all: each was checked on 2026-09-10 and the result written down in [sources-research.md](sources-research.md#fourth-pass--2026-09-10), so a later reader does not repeat the search.

`gnews` reads Google News RSS search per person (100 headlines each, Brazil, pt-BR). Its uris are Google's encoded redirect, not the publisher's, which is why nothing here follows them.

### Full text: `content:encoded`

Every feed collector goes through `toDoc` in `src/collectors/rss.ts`, which builds a document's text from the item title plus its **body**: `content:encoded` when that element carries more characters than `description`, and `description` otherwise. `content:encoded` is where a publisher syndicates the whole article on purpose, and it is the only place in this project a full article body ever comes from — no collector fetches an article page, and none may. Characters per document is what moves the graph (see [sources-research.md](sources-research.md#third-pass--2026-09-10)), so a feed that fills it is worth 15x to 62x one that does not.

Whatever the feed carries, a stored document holds at most **`MAX_DOC_CHARS` = 20 000 characters** (`src/store.ts`). `truncateText` cuts on the last whitespace at or before the limit, so no word is stored in half, and it runs inside the write path before the upsert and before `derive`, so the terms of a document are always the terms of the text actually kept — through `pnpm ingest` and `pnpm reindex` alike. The figure comes from measuring the corpus ([sources-research.md](sources-research.md#fifth-pass--2026-09-10)): the 99th percentile of the longest source is 7.9k and the single longest article 20k, so the cap keeps every article seen and only ever removes a tail. It is a literal, not an environment knob, like `MAX_RESPONSE_BYTES`. Rows stored before the cap are cut to it by `pnpm reindex`, which reports `capped text of N docs`.

Nine of the feeds already collected fill it: `apublica.org`, `noticias.stf.jus.br`, `jota.info`, `intercept.com.br`, `lupa.uol.com.br`, both `camara.leg.br` feeds, `conjur.com.br`, `revistaforum.com.br`. Six more were added to `rss` for that reason alone: `cnnbrasil.com.br`, `metropoles.com`, `poder360.com.br`, `veja.abril.com.br`, `correiobraziliense.com.br`, `osul.com.br`. g1's politics feed fills `description` with the same whole article instead, which `body()` already prefers when it is the longer of the two. These carry only a headline or a summary: Folha, `brasildefato.com.br`, `cartacapital.com.br`, `gazetadopovo.com.br`, `oantagonista.com.br`, `aosfatos.org`, `senado.leg.br`, `agenciabrasil.ebc.com.br`.

A document often arrives twice — a `gnews` headline first, the publisher's own feed later — so `upsertDoc` (`src/store.ts`) keeps **the longer text** on a uri it already knows, and re-derives that document's terms and candidates. Only longer replaces, never merely different, so a feed that truncates cannot undo an enrichment. `doc_persons` is never cleared: the headline named those people and the body only adds. `pnpm ingest` reports the count as `enriched`, which is the early warning for a feed that quietly stops filling the element.

`gkg` downloads GDELT's 15-minute translation GKG files (`*.translation.gkg.csv.zip`), keeps Portuguese rows, uses the original page title as text and the `persons` column to match tracked people. Processed slots are recorded in `gkg_files`, so each run only fetches new ones. `GKG_SLOTS` sets how many recent slots to look back (default 24 = 6h; measured 2026-09-10, one slot was 13.6MB compressed / 43.2MB decompressed). A slot is marked done before its docs are inserted; if the insert fails you must delete the row from `gkg_files` to retry it. The download is bounded on both ends: the compressed zip is capped at `MAX_RESPONSE_BYTES` (32MB, shared with `slowGet` and `rss`'s feed fetch — see [operations](operations.md)), checked against a declared `content-length` before any byte is read and again while streaming if none was declared; the decompressed CSV is capped separately at `MAX_EXPANDED_BYTES` (128MB), enforced while unzipping so a decompression-bomb shape is caught mid-stream. Against the measured slot size that leaves about 2.3x of headroom on the compressed ceiling and about 3x on the decompressed one. The decompressed ceiling is approximate: the compressed bytes are fed to the unzipper in 16KB slices and the running total is only checked between slices, so a bomb-shaped entry can overshoot `MAX_EXPANDED_BYTES` by up to about 16MB before the loop stops feeding it. Either ceiling being crossed skips the slot without marking it done in `gkg_files`, so a later run retries it — the same fate as a slot GDELT never published, and it either eventually succeeds or ages out of the `GKG_SLOTS` look-back window.

`gdelt` (DOC API) enforces ~1 request / 5s per IP and returns 429 aggressively. Off by default.

`camara` and `senado` read a tracked parliamentarian's own floor-speech summaries over the last 30 days, keyed off `camaraId`/`senadoId` in `seed.json`; a person carrying neither is skipped without a request. Both are on by default: unpaced sequential requests to either endpoint answered 200 with no rate limiting (senado 150-280ms, camara 490-730ms). `camara` still retries a 429/5xx three times with backoff, `senado` does not. Neither has a window knob; 30 days is fixed in the collector, so a chamber in recess simply contributes nothing.

`senado` pulls plenary speech summaries (`discursos`/`pronunciamentos`, last 30 days) for tracked senators from `dadosabertos.senado.leg.br`, keyed by each person's `senadoId` in `seed.json`; people without one are skipped, no request made. Unlike `gdelt`/`gkg`, the Senado Federal's open-data API has no published rate limit, so the collector only pauses briefly (~500ms) between senators for politeness, not to dodge a 429.

`juridico`, `oficial` and `nicho` are three named RSS collector families, each reusing `fetchFeed` from `src/collectors/rss.ts` with no bespoke fetch or XML handling, so the source filter can separate legal Portuguese press and outlet divergence from the generic `rss` bucket instead of collapsing everything into one feed list. Alias matching, person tagging and untoned `tone: null` behave exactly as `rss`'s, with no `camaraId`/`senadoId`-style gate: a person the feeds never mention returns zero rows for that source, no error. All three ship in `defaultSources` (they are plain RSS `GET`s, not rate-limited APIs like `gdelt`).

- `rss` (generic press): g1 and Folha, politics sections; `veja.abril.com.br` and `correiobraziliense.com.br`, politics sections too; `cnnbrasil.com.br`, `metropoles.com`, `poder360.com.br` and `osul.com.br`, whole site, because those four publish no politics feed.
- `juridico` (courts/legal press): `noticias.stf.jus.br`, `conjur.com.br`, `jota.info`.
- `oficial` (institutional press): `camara.leg.br`'s POLITICA and ELEICOES feeds, `senado.leg.br`, `agenciabrasil.ebc.com.br`. Planalto's RSS feed is RDF, not RSS 2.0, and is deliberately excluded — `rss.ts`'s parser assumes RSS 2.0 for every feed and adding RDF support is left to a follow-up issue.
- `nicho` (partisan/investigative/fact-check press): `brasildefato.com.br`, `revistaforum.com.br`, `cartacapital.com.br`, `gazetadopovo.com.br`, `oantagonista.com.br`, `intercept.com.br`, `apublica.org`, `aosfatos.org`, `lupa.uol.com.br`, `revistaoeste.com`. `revistaoeste.com` is the one feed in the family that still ships the article body rather than a summary (1949 chars a item on 2026-09-10, against 100-400 for the rest), which is what makes a doc move the graph at all — see [source research](sources-research.md). `outlets.json` is not extended with `lean`/`basis` for these domains in this issue; they show no lean badge until a follow-up research issue fills it in.


## Tracked people

`seed.json` (repo root) is the list. Aliases match as whole words, case- and accent-insensitive, and longer aliases win over bare ones across people: "Flávio Bolsonaro" tags Flávio only, never Jair's bare "Bolsonaro". An optional `exclude` list names lookalikes that must not match ("Ciro Nogueira" for Ciro Gomes). A one-word alias like "Leite" matches the beverage, so prefer full names for common words.

An optional `camaraId` (deputy id from `dadosabertos.camara.leg.br`) enables the `camara` collector for that person, `senadoId` (senator code from `dadosabertos.senado.leg.br`) enables `senado`; a person may carry either, both, or neither, and is skipped by a collector whose id it lacks.

Scope is politicians and public figures of the political sphere only. People removed from the seed are pruned on the next `pnpm ingest`; their docs stay as PMI baseline. Run `pnpm reindex` after editing the file.
