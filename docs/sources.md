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

`rss` reads two feeds, both the outlet's politics section rather than its front page: `g1.globo.com/rss/g1/politica/` and `feeds.folha.uol.com.br/poder/rss091.xml`. Only docs naming a tracked person get `doc_terms` rows ([terms](terms.md)), so a front page spends most of its items on nobody: measured on 2026-09-09, g1's front page named someone tracked in 18 of 100 items against the politics feed's 89, and Folha's `emcimadahora` in 26 against `poder`'s 77. g1's politics feed also carries the article body (4392 chars a item, against the front page's 2607 and Folha's 389), which is why `rss` averages an order of magnitude more text per doc than `gkg` or `bluesky`.

`gnews` reads Google News RSS search per person (100 headlines each, Brazil, pt-BR).

`gkg` downloads GDELT's 15-minute translation GKG files (`*.translation.gkg.csv.zip`), keeps Portuguese rows, uses the original page title as text and GDELT themes as `theme` terms. Processed slots are recorded in `gkg_files`, so each run only fetches new ones. `GKG_SLOTS` sets how many recent slots to look back (default 24 = 6h; measured 2026-09-10, one slot was 13.6MB compressed / 43.2MB decompressed). A slot is marked done before its docs are inserted; if the insert fails you must delete the row from `gkg_files` to retry it. The download is bounded on both ends: the compressed zip is capped at `MAX_RESPONSE_BYTES` (32MB, shared with `slowGet` and `rss`'s feed fetch — see [operations](operations.md)), checked against a declared `content-length` before any byte is read and again while streaming if none was declared; the decompressed CSV is capped separately at `MAX_EXPANDED_BYTES` (256MB), enforced while unzipping so a decompression-bomb shape is caught mid-stream. Against the measured slot size that leaves about 2.3x of headroom on the compressed ceiling. The decompressed ceiling is approximate: the compressed bytes are fed to the unzipper in 64KB slices and the running total is only checked between slices, so a bomb-shaped entry can overshoot `MAX_EXPANDED_BYTES` by up to about 64MB before the loop stops feeding it. Either ceiling being crossed skips the slot without marking it done in `gkg_files`, so a later run retries it — the same fate as a slot GDELT never published, and it either eventually succeeds or ages out of the `GKG_SLOTS` look-back window.

`gdelt` (DOC API) enforces ~1 request / 5s per IP and returns 429 aggressively. Off by default.

`camara` and `senado` read a tracked parliamentarian's own floor-speech summaries over the last 30 days, keyed off `camaraId`/`senadoId` in `seed.json`; a person carrying neither is skipped without a request. Both are on by default: unpaced sequential requests to either endpoint answered 200 with no rate limiting (senado 150-280ms, camara 490-730ms). `camara` still retries a 429/5xx three times with backoff, `senado` does not. Neither has a window knob; 30 days is fixed in the collector, so a chamber in recess simply contributes nothing.

`senado` pulls plenary speech summaries (`discursos`/`pronunciamentos`, last 30 days) for tracked senators from `dadosabertos.senado.leg.br`, keyed by each person's `senadoId` in `seed.json`; people without one are skipped, no request made. Unlike `gdelt`/`gkg`, the Senado Federal's open-data API has no published rate limit, so the collector only pauses briefly (~500ms) between senators for politeness, not to dodge a 429.

`juridico`, `oficial` and `nicho` are three named RSS collector families, each reusing `fetchFeed` from `src/collectors/rss.ts` with no bespoke fetch or XML handling, so the source filter can separate legal Portuguese press and outlet divergence from the generic `rss` bucket instead of collapsing everything into one feed list. Alias matching, person tagging and untoned `tone: null` behave exactly as `rss`'s, with no `camaraId`/`senadoId`-style gate: a person the feeds never mention returns zero rows for that source, no error. All three ship in `defaultSources` (they are plain RSS `GET`s, not rate-limited APIs like `gdelt`).

- `juridico` (courts/legal press): `noticias.stf.jus.br`, `conjur.com.br`, `jota.info`.
- `oficial` (institutional press): `camara.leg.br`'s POLITICA and ELEICOES feeds, `senado.leg.br`, `agenciabrasil.ebc.com.br`. Planalto's RSS feed is RDF, not RSS 2.0, and is deliberately excluded — `rss.ts`'s parser assumes RSS 2.0 for every feed and adding RDF support is left to a follow-up issue.
- `nicho` (partisan/investigative/fact-check press): `brasildefato.com.br`, `revistaforum.com.br`, `cartacapital.com.br`, `gazetadopovo.com.br`, `oantagonista.com.br`, `intercept.com.br`, `apublica.org`, `aosfatos.org`, `lupa.uol.com.br`, `revistaoeste.com`. `revistaoeste.com` is the one feed in the family that still ships the article body rather than a summary (1949 chars a item on 2026-09-10, against 100-400 for the rest), which is what makes a doc move the graph at all — see [source research](sources-research.md). `outlets.json` is not extended with `lean`/`basis` for these domains in this issue; they show no lean badge until a follow-up research issue fills it in.


## Tracked people

`seed.json` (repo root) is the list. Aliases match as whole words, case- and accent-insensitive, and longer aliases win over bare ones across people: "Flávio Bolsonaro" tags Flávio only, never Jair's bare "Bolsonaro". An optional `exclude` list names lookalikes that must not match ("Ciro Nogueira" for Ciro Gomes). A one-word alias like "Leite" matches the beverage, so prefer full names for common words.

An optional `camaraId` (deputy id from `dadosabertos.camara.leg.br`) enables the `camara` collector for that person, `senadoId` (senator code from `dadosabertos.senado.leg.br`) enables `senado`; a person may carry either, both, or neither, and is skipped by a collector whose id it lacks.

Scope is politicians and public figures of the political sphere only. People removed from the seed are pruned on the next `pnpm ingest`; their docs stay as PMI baseline. Run `pnpm reindex` after editing the file.
