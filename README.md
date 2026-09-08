# rashomon

Rashomon: which words a Brazilian political figure is associated with, across Bluesky, Google News, GDELT, RSS feeds, the Senado Federal and the Câmara dos Deputados. MVP.

## Run

```bash
pnpm install
pnpm ingest          # default sources: bluesky, rss, gnews, gkg, senado, camara; or: pnpm ingest gkg
pnpm ingest gdelt    # GDELT DOC API, slow and rate limited, off by default
pnpm dev             # http://localhost:3210
pnpm reindex         # recompute terms, person matches and candidates after changing extract.ts or seed.json
pnpm score           # scores every unscored (doc, person) pair with TESTIMONY_SCORER (default onnx; needs TESTIMONY_REVISION)
pnpm export-docs     # dumps every doc as one JSON line to stdout, for kikori's training set
pnpm bench           # API latency baseline against a synthetic database of its own
pnpm bench:writes    # ingest/reindex write-path baseline: statements, throughput, peak memory
pnpm typecheck       # tsc
pnpm test            # node:test against an in-memory database
```

`PORT` sets the server port (default 3210). `DATA_DIR` sets the PGlite directory (default `./data/pg`); `memory://` is in-memory and is what tests use. PGlite allows one process per directory: stop the server before `ingest` or `reindex`. `ANALYZE_MIN_DOCS` (default 200) is the ingest size from which planner statistics are refreshed, see "Indexes and planner statistics". `WRITE_BATCH_ROWS` (default 500, clamped to 1..10000) and `WRITE_BATCH_DOCS` (default 200, clamped to 1..5000) bound what one insert statement carries and what one transaction holds, see "Writes, batches and recovery".

## Deploy

`DATABASE_URL` (or `POSTGRES_URL`, what the Vercel Supabase integration injects) switches every command from embedded PGlite to a managed Postgres over `pg`. Without it nothing changes. The serverless filesystem is read-only and short-lived, so a managed database is the only shape that works on Vercel; `api/index.ts` wraps the Hono app and `vercel.json` serves `public/` from the CDN.

```bash
vercel env pull .env.local                                          # POSTGRES_URL, POSTGRES_URL_NON_POOLING
DATABASE_URL=$POSTGRES_URL_NON_POOLING pnpm migrate                 # create the schema once
DATABASE_URL=$POSTGRES_URL_NON_POOLING DATA_DIR=./data/pg pnpm push # one-way copy of a local PGlite into it
vercel deploy --prod
```

Collectors and scoring do not run on Vercel: run `pnpm ingest`, `reindex` and `score` from a machine with `DATABASE_URL` set, or keep collecting locally and `pnpm push` again (inserts skip rows that already exist). `TESTIMONY_DTYPE` and `TESTIMONY_REVISION` have to match between that machine and the deployed environment, or `/testimony` answers empty — see "Model revision". `PG_POOL_MAX` caps connections per function instance (default 3).

Bluesky without login returns one page (100 posts) per person. To paginate, set `BSKY_HANDLE` and `BSKY_APP_PASSWORD` (app password, not the account password).

`gnews` reads Google News RSS search per person (100 headlines each, Brazil, pt-BR).

`gkg` downloads GDELT's 15-minute translation GKG files (`*.translation.gkg.csv.zip`), keeps Portuguese rows, uses the original page title as text and GDELT themes as `theme` terms. Processed slots are recorded in `gkg_files`, so each run only fetches new ones. `GKG_SLOTS` sets how many recent slots to look back (default 24 = 6h, ~3.5MB each). A slot is marked done before its docs are inserted; if the insert fails you must delete the row from `gkg_files` to retry it.

`gdelt` (DOC API) enforces ~1 request / 5s per IP and returns 429 aggressively. Off by default.

`camara` and `senado` read a tracked parliamentarian's own floor-speech summaries over the last 30 days, keyed off `camaraId`/`senadoId` in `seed.json`; a person carrying neither is skipped without a request. Both are on by default: unpaced sequential requests to either endpoint answered 200 with no rate limiting (senado 150-280ms, camara 490-730ms). `camara` still retries a 429/5xx three times with backoff, `senado` does not. Neither has a window knob; 30 days is fixed in the collector, so a chamber in recess simply contributes nothing.

- `seed.json` tracked people and aliases. Longer aliases win over bare ones across people; an optional `exclude` list names lookalikes that must not match ("Ciro Nogueira"). An optional `camaraId` (federal deputy id from `dadosabertos.camara.leg.br`) enables the `camara` collector for that person. Scope: politicians and public figures of the political sphere only. People removed from the seed are pruned on the next `pnpm ingest`; their docs stay as PMI baseline

`senado` pulls plenary speech summaries (`discursos`/`pronunciamentos`, last 30 days) for tracked senators from `dadosabertos.senado.leg.br`, keyed by each person's `senadoId` in `seed.json`; people without one are skipped, no request made. Unlike `gdelt`/`gkg`, the Senado Federal's open-data API has no published rate limit, so the collector only pauses briefly (~500ms) between senators for politeness, not to dodge a 429.

## API

`GET /api/people`

`GET /api/people/:id/graph?days=30&source=all|bluesky|gdelt|rss|gnews|gkg|camara|senado&kind=all|hashtag|word|theme&sort=count|pmi&limit=40&min=2`

Add `domain=<host>` to restrict the graph to one outlet (or one Bluesky handle). Like `source`, `domain` also accepts a comma-separated list (e.g. `domain=cartacapital.com.br,poder360.com.br`), matching any listed host; a single `domain=<host>` behaves exactly as before.

`source` also accepts a comma-separated list (e.g. `source=gnews,rss,gkg`) on `graph`, `sources` and `docs`: it matches docs whose source is any of the listed values. Unknown tokens are dropped silently, duplicates collapse, and an empty or all-invalid list falls back to `all`; a single token behaves exactly as before. `rising` and `timeline` still take a single `source` value.

`lean=left|right|center` (comma-separated, e.g. `lean=left,right`) is additive on `graph`, `docs`, `rising`, `timeline` and `sources` — see "Editorial lean" below. `domain` and `lean` intersect: when both are given, only docs whose domain satisfies `domain` *and* is labeled with one of the requested `lean` values are counted; an empty intersection returns zero docs, not `all`.

`GET /api/people/:id/sources?days=30&source=all&lean=all` lists outlets that mention the person: `domain`, `source`, `docs`, `tone` (average GDELT tone, null when unknown), `tone_n`, `lean` and `basis` (see "Editorial lean" below; both `null` when the domain is absent from `outlets.json`). Also honours `domain`, previously silently ignored on this route.

Returns `{ person, stats, nodes, links, signature, outlets }`. Each node also carries `tone`: average GDELT tone of the docs where the term co-occurs with the person, null when no GDELT doc contributed. `pmi` is log2 of how much more often the term co-occurs with the person than chance, measured against the docs in the window that mention at least one tracked person (see "Terms and the PMI universe"). `outlets` is `{ domain, lean, basis }[]`, empty when `lean` is unset/`all`, otherwise every `outlets.json` entry matching the resolved `domain`+`lean` scope. `nodes` is ordered by `sort` desc, then `term` asc, then `kind` asc: a term is a `(term, kind)` pair, so the same text can appear under two kinds, and `kind` is what ranks those against each other when everything else ties. `links` carries the person spokes in `nodes` order, then the term-term pairs ordered by `source` then `target`.

`signature` holds at most 5 rows of `{ term, kind, count, pmi }` (no `tone`): the terms whose count clears `max(3, 5% of stats.about)`, ordered by `pmi` desc then `term` asc then `kind` asc, computed over the same `days`/`source`/`domain` scope as the graph but ignoring `kind`, `min`, `limit` and `sort`, so it is not guaranteed to be a subset of `nodes`.

`GET /api/people/:id/docs?term=&kind=all|hashtag|word|theme&days=30&source=all|bluesky|gdelt|rss|gnews|gkg|camara|senado&domain=all&lean=all&limit=50&offset=0` lists the docs behind a graph term (or every doc about the person when `term` is omitted): `{ total, docs, outlets }`, each doc `{ id, source, domain, published_at, text, uri, tone }`, newest first. `term` matches normalized tokens exactly, not substrings. `outlets` follows the same rule as `graph`'s.

`GET /api/people/:id/rising?days=7&baseline=30&kind=all|hashtag|word|theme&source=all|bluesky|gdelt|rss|gnews|gkg|camara|senado&domain=all&lean=all&limit=20&min=3` returns `{ days, baseline, terms, outlets }`, each term `{ term, kind, count_recent, count_baseline, lift }` (no `tone`). `count_recent`/`count_baseline` are raw doc counts turned into per-day rates rounded to 2 decimals; the baseline window is the `baseline` days immediately preceding the recent window, never overlapping it. `lift` is `(count_recent_raw / days) / ((count_baseline_raw + 1) / baseline)`, a pinned formula, not to be changed without a test. Rows are ordered by `lift` desc, then `term` asc, then `kind` asc.

`GET /api/people/:id/timeline?term=&kind=all|hashtag|word|theme&days=30&source=all|bluesky|gdelt|rss|gnews|gkg|camara|senado&domain=all&lean=all&bucket=week|day` returns a bare JSON array of `{ bucket_start, count }` (no `tone`, no `outlets` — this route's contract stays a bare array), oldest bucket first, `ceil(days / bucket_days)` items. Buckets are rolling windows counted backward from query time, not calendar/ISO weeks; the oldest bucket is clamped to the window edge so counts sum exactly to `/docs`'s `total` for the same `term`/`kind`/`days`/`source`/`domain`/`lean`.

`GET /api/tone?days=30&min=3` returns `{ persons, domains, cells }` across every tracked person (not nested under `/people/:id`). `persons` is `{ id, name }` for every row in `persons`, ordered by name, present even with zero cells. `domains` is the sorted distinct set of domains that appear in `cells` (a domain that never clears `min` never appears). `cells` holds one `{ person_id, domain, tone, n }` row per `(person, domain)` pair with at least `min` toned docs in the window; `tone` is the average, rounded to 2 decimals, `n` is the toned-doc count. Tone is a GDELT-only signal (see below), so non-GDELT docs never contribute to `tone` or `n` here.

`GET /api/people/:id/graph?…&testimony=1` adds, to the same response, `stats.testimony = { method, score, n }` (the person's mean score over the docs in scope, so it follows `domain`/`lean`, unlike `/testimony`) and `testimony: { score, n } | null` on every node: the mean score of the in-scope docs that carry the term, `null` when none has a non-null score. `method` resolves exactly as on `/testimony` (`?method=` or the default label). Without `testimony=1` nothing is added and the response is byte-for-byte what it was. The atlas always sends it and uses it for the "Colorir por avaliação" mask, which colours each word by its distance from the person's own mean rather than from zero, so the name prior cancels out.

`GET /api/people/:id/testimony?days=30&source=all&method=kikori:q8&min=3` returns `{ method, overall, by_source, by_domain }`, a second, source-agnostic signal scored -10..+10 per `(doc, person)` by a pluggable scorer (see below), stored separately from and never merged with GDELT's `tone`. `overall` is `{ score, n }` averaged over every doc scored under `method` in the window, no floor. `by_source` lists one `{ source, score, n }` row per source with at least one non-null score (no `min` floor). `by_domain` lists one `{ domain, source, score, n }` row per `(domain, source)` pair with `n >= min`; a doc with no resolvable `domain` never appears here, though it still counts in `overall`/`by_source`. `method` reads whatever rows exist in `doc_testimony` for that label, including a retired scorer's; an unscored `method` returns `{ score: null, n: 0 }` everywhere, not a 404. When `?method` is omitted or fails its charset check, it resolves through the same `methods` map `pnpm score` uses (`src/scorers/index.ts`): `kikori:<dtype>:<revision>`, `q8` unless `TESTIMONY_DTYPE` picks another dtype and the bare `kikori:<dtype>` when `TESTIMONY_REVISION` is unset. This match only holds if `TESTIMONY_DTYPE` and `TESTIMONY_REVISION` are set the same way in the process that ran `pnpm score` and the process serving the route — see "Testimony and scoring" below for the failure mode when it isn't.

`GET /api/candidates?days=7&min=5&limit=50` returns `{ days, candidates }`: person names nobody tracks yet, ranked by doc count in the window. Each candidate is `{ name, count, sources, previous, samples }`: `count` is distinct docs in the window, `sources` distinct sources, `previous` the count in the window of the same length immediately before (so a caller sees what is rising), `samples` up to 3 `{ id, source, text }` docs, newest first. Cross-person by construction, not nested under `/people/:id`. Promotion stays human: add the name to `seed.json` and run `pnpm reindex`.

## Candidate discovery

Names are discovered when a doc is inserted (`insertDoc`) and stored in `doc_candidates (doc_id, name)`, normalized like aliases (lowercase, no accents). `gkg` docs take the V1Persons column of the GKG CSV (index 11), kept in `docs.extra_names`; every other source uses a cheap, noisy heuristic: runs of two or more capitalized words (`de/da/do/das/dos` allowed inside) that do not open a sentence, where only `.`, `!`, `?` and a line break end a sentence and a colon, comma, quote or dash merely ends the run. A name equal to a tracked alias or `exclude` entry is not a candidate (exact match, so "Michelle Bolsonaro" still surfaces while only a bare "Bolsonaro" is tracked). `pnpm reindex` recomputes the table from stored docs with the current `seed.json`; gkg rows inserted before this table existed have an empty `extra_names` and contribute no candidates until re-ingested.

## Testimony and scoring

`doc_testimony` holds one `{ doc_id, person_id, method, score }` row per attempt: `score` is `null` when the scorer could not form an opinion (e.g. empty text), inserted anyway so the pair is not retried. `pnpm score` (env `TESTIMONY_SCORER`, default `onnx`) scores every `(doc, person)` pair in `doc_persons` that lacks a row for that method yet; re-running under a different `TESTIMONY_SCORER` value adds a second, independent row set rather than overwriting the first. Scorers live in `src/scorers/`: `stub` is deterministic and hermetic (tests only); `onnx` loads `TESTIMONY_MODEL` ([drifting-walter/kikori](https://huggingface.co/drifting-walter/kikori)) at revision `TESTIMONY_REVISION` via `@huggingface/transformers` (cache dir `MODEL_DIR`, default `./data/models`; `TESTIMONY_DTYPE` picks `q8`, the default, 110 MB / ~6 ms per short text, or `fp32`, 436 MB / ~12 ms) and is never exercised by a plain `pnpm test`. The scorer name and the row label differ: `TESTIMONY_SCORER=onnx` writes rows as `method = kikori:<dtype>:<revision>` (`kikori:q8`, `kikori:fp32`), so rows from the earlier placeholder (`onnx`, single label, person ignored) are never mixed with kikori's, and `pnpm score` re-scores every pair whose only row is from another method. See "Model revision" below for why the revision is in there and why `pnpm score` refuses to run without it. The old placeholder rows (`method = onnx`) are kept, not purged: they cost nothing to leave in `doc_testimony` and stay reachable with `?method=onnx` for comparison.

`GET /api/people/:id/testimony` with no `?method` resolves its default through `src/scorers/index.ts`'s `methods` map, the same map `pnpm score` reads to pick its row label — resolved fresh on every request, not cached. **This depends on `TESTIMONY_DTYPE` and `TESTIMONY_REVISION` in the process serving the route, not on what `pnpm score` last actually wrote.** If `TESTIMONY_DTYPE=fp32 pnpm score` populated `kikori:fp32:<rev>` rows but the server runs `pnpm dev` with no `TESTIMONY_DTYPE`, the route defaults to `kikori:q8:<rev>`, finds no rows, and silently answers `{ score: null, n: 0 }` everywhere — not an error. The same goes for a `TESTIMONY_REVISION` that differs between the two, and for a server that has none while the rows are versioned. Keep both consistent between the scoring job and the serving process (e.g. both set from the same `.env`/deploy config), or pass `?method=` explicitly from the client. The response always echoes the `method` it answered under, which is how a client tells "no rows under that label" from "no rows at all".

### Model revision

`TESTIMONY_REVISION` is the Hub revision of `TESTIMONY_MODEL` — a commit sha, tag or branch — and it does two things at once: it is passed to `from_pretrained`, so the scorer loads that exact revision instead of whatever `main` points at today, and it is the last segment of the row label. Its charset is `/^[\w.-]{1,64}$/`, narrower than the method parser's, so `kikori:<dtype>:<revision>` always survives `?method=` whole; anything outside it reads as unset.

**Why it exists (issue #67).** `scoreAll` skips any pair that already has a row under the label it is writing. With the dtype alone in the label, a retrain republished under the same name left all 19937 existing rows untouched and scored only the pairs added since — with the new model, under the old model's name, and nothing in the store recording the split. Kikori's training is not bit-reproducible, so two "same" models differ enough that an outlet-vs-outlet comparison spanning the split would partly be a model-vs-model comparison. With the revision in the label, a model change produces a new label and `pnpm score` re-scores every pair on its own (21379 pairs at ~6 ms in q8, about two minutes).

**`pnpm score` refuses to run the `onnx` scorer without it**, before it opens the database. An env var nobody is forced to set is exactly as forgettable as the manual `doc_testimony` purge this replaces, and it is the forgetting that causes the bug. `TESTIMONY_SCORER=stub` is unaffected: it is a pure function of its inputs with no model behind it.

**Rows scored before this existed carry the bare `kikori:<dtype>` label and are left alone**, readable with `?method=kikori:q8`. They are not migrated, because nothing knows which revision produced them. The first versioned run therefore writes a full second set of rows, and until it happens the route answers `{ score: null, n: 0 }` for any server that has `TESTIMONY_REVISION` set. Order of operations on a deploy: re-score locally with the revision set, `pnpm push`, then set the same `TESTIMONY_REVISION` on the serving environment.

### The kikori contract

The model carries its own contract in `config.json["kikori"]`, and the scorer reads it from there rather than hard-coding it:

- **Input** is the pair `[CLS] person.name [SEP] text [SEP]`, `token_type_ids` 0 for the person segment and 1 for the text. The person is part of the input: the same doc scores differently for each person it mentions.
- **Labels** are `neg, neu, pos` in that order (`config.json["kikori"].labels`). **Score** is `(p_pos - p_neg) * 10` over `softmax(logits)`, range -10..+10; the model's class cut is `neg <= -2.5`, `pos >= 2.5`.
- **Truncation** is done by hand: only the text is cut, to `max_length - len(person tokens) - 3` (`max_length` 256), so the closing `[SEP]` always survives. `tokenizer(person, { text_pair, truncation: true })` in transformers.js drops the last `[SEP]` on long texts and moves the score; the scorer never uses it.
- **Known bias**: the person's name acts as a prior. The same hostile sentence scores about +1.9 with Lula as target and about -4 with Tarcísio or Bolsonaro. Read testimony as "this outlet vs other outlets on the same person", never as "person A vs person B".

`test/kikori-fixtures.json` is the model's own fixture set (24 pool pairs, 16 short and 8 long, no holdout text) with `score_fp32` and `score_int8`. `KIKORI_CHECK=1 pnpm test` downloads the model and runs the real scorer over it, asserting `fp32` within 0.01 of `score_fp32` and `q8` within 1.5 of `score_int8` (dynamic int8 picks activation scales at run time; Node and Python differ by 0.30 mean, 1.29 max on these fixtures). `KIKORI_CHECK=q8` or `=fp32` runs one dtype.

## Editorial lean

`outlets.json` (repo root) labels a handful of domains with a researched editorial `lean` (`left`/`right`/`center`) and a `basis`: `third_party_consensus` (an outside source describes the outlet's line) or `self_declared` (the outlet's own claim about itself, no independent audit found). Each entry also carries a `note` and `sources` (citation URLs), kept for humans reading the file and in the README, not echoed in API responses — a client wanting the citations reads `outlets.json` directly.

This is metadata about a *source*, resolved fresh from the static file on every request; it is never written into the `docs` table or backfilled onto stored rows, the same way GDELT `tone` is never guessed for a non-GDELT doc. `lean`/`domain` matching is exact-string equality against `docs.domain` (no subdomain or fuzzy matching).

**A `lean` label is a researched editorial judgment call with cited sources, not a fact.** It can be wrong, outdated, or contested; read the `note`/`sources` in `outlets.json` before treating it as more than a starting point. **A domain's absence from `outlets.json` never implies neutrality or a lack of bias** — it means nobody has researched and labeled that outlet yet, nothing more. Only five domains are labeled today; `outlets.json` only ever labels whole domains, never individual authors or sections.

## Domain and tone

Every doc stores `domain`: outlet host for news (`gnews` uses the `<source>` element, not the Google redirect link), author handle for Bluesky. `tone` comes only from GDELT GKG (V2Tone, first field, roughly -10..+10; political news sits around -1). Other sources have `tone = null`. A doc keeps the source that first stored it, so a later GKG row sharing the URL never adds tone to an rss/gnews doc. Outlet names are stripped from Google News text so they do not become terms.

`pnpm purge <source>` deletes that source's docs (and resets `gkg_files` for `gkg`), for a clean re-fetch.

## Terms and the PMI universe

Terms are only stored for docs that mention at least one tracked person. A doc naming nobody tracked keeps its `docs` row (it still feeds `/api/candidates` and the source counts) but gets no `doc_terms` rows: they used to serve only as the PMI denominator, at two thirds of the largest table. PMI therefore compares a person's terms against the docs about tracked people in the window, not against everything collected; `stats.docs` keeps its old meaning (every doc in scope).

`pnpm purge orphan-terms` deletes the term rows a database collected before this rule and runs `vacuum full doc_terms` to return the pages to disk (plain `vacuum` only marks them reusable and leaves the file the same size). It takes an exclusive lock on `doc_terms`, so run it with the server stopped; it is a one-off per database, and `pnpm reindex` produces the same result from scratch. `pnpm purge <source>` does the same for the tables its cascade empties.

## Writes, batches and recovery

Ingest and reindex are the only write paths, and both are bounded in the same two ways: `WRITE_BATCH_ROWS`
rows per insert statement, `WRITE_BATCH_DOCS` documents per transaction. Neither bound grows with the size
of the corpus, so a run over 20k or 200k documents holds the same amount of memory and never keeps a
transaction open across an arbitrary amount of work.

- **Batches.** Person, term and candidate rows go in through `unnest`, one statement per batch instead of
  one per row, with `on conflict do nothing` so replaying a batch is a no-op rather than a duplicate-key
  failure. The person seed is upserted the same way, from json, because `unnest` on a `text[][]` would
  flatten one person's aliases into the next.
- **Transactions.** `insertDoc` writes a document and everything derived from it in one transaction: a
  document can never end up in `docs` without the person, term and candidate rows it implies. `pnpm ingest`
  uses the bulk form, which commits a group of documents at a time; a group that fails rolls back whole and
  is then replayed document by document, so one unwritable document costs only itself and the rest of the
  group still lands. The failure count is printed per source.
- **No pointless updates.** The `on conflict` on `docs` carries a `where`: a re-collected document that
  would change neither `domain` nor `tone` writes no new row version at all. The two rules it has to keep
  survive it — the first source still owns the row (`coalesce(docs.domain, excluded.domain)`), and a
  non-GDELT source still resolves to a null tone.
- **Reindex.** It reads documents by keyset pagination on the primary key (`where id > $1 order by id
  limit $2`), never materializing more than one page of text, and commits one transaction per page.

**Recovery from an interrupted reindex.** Run `pnpm reindex` again. It starts by truncating
`doc_terms`, `doc_persons` and `doc_candidates` and rebuilds from `docs`, so it depends on no previous
state and is idempotent: interrupting it can leave the derived tables holding fewer documents than `docs`,
but never a document with only part of its rows, because each page is a transaction. There is deliberately
no resume watermark: a document that names nobody and yields no candidate writes no derived row at all, so
the highest `doc_id` present in the derived tables is not evidence of where a run stopped, and resuming
from it would silently skip documents. A full rebuild is cheap enough (about 7 s per 20k documents here)
that guessing is not worth it. The same command repairs a database whose derived rows were damaged any
other way, and `pnpm ingest` is safe to run before it: its writes are per document and complete.

**Vacuum.** `pnpm reindex` empties its three derived tables with `truncate`, not `delete`. PGlite has no
autovacuum, so deleting every row would leave the pages dead and the rebuild would append past them: on the
20k-document benchmark the database grew from 32.1 MB to 41.0 MB after one reindex and 49.4 MB after two,
while truncate holds it at 32.1 MB across any number of runs. That is why no vacuum follows a reindex. A
`pnpm purge` is the opposite case — a permanent deletion whose pages are never refilled — so it runs
`vacuum full` on the tables it emptied, as `purge orphan-terms` already did. Neither ever runs from a
request: like `analyze`, both belong to the process that owns `DATA_DIR`, with the server stopped.

**Measuring it.** `pnpm bench:writes` builds a deterministic synthetic corpus (the same
`src/bench-corpus.ts` as `pnpm bench`) in its own `DATA_DIR`, then reports statements sent to PGlite,
throughput, peak RSS, peak heap and database size for an ingest and for two consecutive reindexes. Like
`pnpm bench` it refuses to open `./data/pg`. Knobs: `BENCH_WRITES_DOCS` (20000), `BENCH_WRITES_DATA_DIR`
(`./data/bench-writes`), `BENCH_WRITES_DAYS`, `BENCH_WRITES_SEED`, `BENCH_WRITES_NOW`.

## Indexes and planner statistics

`migrate()` is the whole schema: `create table if not exists` / `create index if not exists`, so it is
idempotent and runs the same against `memory://` in tests as against a directory with data in it.

One index exists because it was measured, not because it looked plausible: `doc_persons (person_id, doc_id)`.
The table's primary key is `(doc_id, person_id)`, but every person-scoped route filters on `person_id`
first, so the key could not serve them and each request scanned the whole table. Adding the reversed pair
makes the scope an index-only lookup (the second column is `doc_id` precisely so nothing has to visit the
heap), and on the 20k-doc benchmark corpus it cuts `/sources` by 25%, `/docs` by 22%, its count query by
34%, `/testimony` by 21-26% and `/rising` by 13%, for 0.27 MB, under 1% of the database. `/graph`'s
`terms` and `signature` do not move: they are dominated by `doc_terms`, not by the person scope.

Three further candidates were benchmarked and **rejected**, each for its own reason:

| candidate | verdict |
| --- | --- |
| `docs (source, published_at)` | only two plans reference it and neither timing moves outside noise; 0.62 MB for nothing |
| `docs (domain, published_at)` | one plan references it, 0% change; 0.88 MB on top of the `docs (domain)` it does not replace |
| `docs (published_at desc, id desc)` | no plan uses it at all: the window filter already selects half the table, where a sequential scan is correct, and `docs`'s `order by` sorts a few hundred joined rows |

The numbers, the plans and the method are in `docs/perf-baseline.md` and in the PR for issue #44. Re-run
them with `pnpm bench` after any schema change; a candidate index that no plan references is a candidate
that does not ship.

**Statistics.** Postgres estimates row counts from statistics that a bulk write leaves stale, and PGlite
has no autovacuum daemon to refresh them, so `analyze` is explicit here — targeted at the five tables the
queries touch, never database-wide, and never from a request:

- `pnpm reindex` always analyzes: it empties and refills `doc_terms`, `doc_persons` and `doc_candidates`,
  so every estimate about them is wrong by the time it returns.
- `pnpm ingest` analyzes only after a *large* ingest: at least `ANALYZE_MIN_DOCS` new docs (default 200,
  clamped to 1..1000000). A run that adds a handful of documents does not move an estimate and skips it,
  printing why.
- Nothing else ever calls it. There is no cron job and no maintenance script, and a test asserts that no
  module outside `src/db.ts`, `src/ingest.ts`, `src/reindex.ts` and `src/bench.ts` runs `analyze`.

That is what keeps maintenance inside the process that owns `DATA_DIR`. PGlite allows one process per
directory, so a second one cannot analyze a database the server is holding — it could not even open it.
Adding the index to a database that predates it is the same one-off: `pnpm reindex` (or any other command
that calls `migrate()`) builds it, in about 100 ms per 8k rows, with the server stopped as usual.

## Performance baseline

Two separate things: opt-in instrumentation on the running API, and a benchmark that builds its own database and reports numbers. Both are local, free and offline. Browser rendering time is out of scope here; this measures API latency and database work only.

**Instrumentation.** Off by default: with `PERF` unset, `db` is the bare PGlite instance and no middleware is registered, so nothing wraps a query and no response changes. `PERF=1 pnpm dev` turns it on and adds, per `/api/*` request, the response headers `x-perf-total-ms`, `x-perf-db-ms` and `x-perf-sql-count`, plus one JSON line on stdout:

```json
{"perf":"request","method":"GET","path":"/api/people/lula/graph","query":"days=30","status":200,"ms":227.6,"db_ms":446.2,"sql":5}
```

`sql` counts statements sent to PGlite during the request and `db_ms` sums the time awaited on them, so a route that fans out with `Promise.all` reports more `db_ms` than `ms`; the difference is the concurrency. The line carries the request line and timings only — never a row, a response body or an environment value — so no document text and no credential can reach a log. `PERF_LOG=0` keeps the counters and headers and silences the line. Headers are additive: response bodies are byte-identical with and without `PERF`.

**Benchmark.** `pnpm bench` generates a deterministic synthetic corpus (`src/bench-corpus.ts`, fixed seed) into its own `DATA_DIR`, replays every scenario in `src/bench-scenarios.ts` (graph, sources, docs, timeline, tone, testimony, rising, candidates, people) and writes `docs/perf-baseline.md`: environment, table sizes, cold and warm p50/p95 per scenario, statements per request, and `EXPLAIN (ANALYZE, BUFFERS)` for each statement the routes run. No network, no external API, no paid tooling.

The dataset is synthetic on purpose. It resembles production in shape — source mix, recency skew, roughly a third of docs naming a tracked person, a Zipf vocabulary — not in content. **The benchmark never opens `./data/pg`**: PGlite allows one process per directory, so a second opener corrupts it. Generation runs in a child process and the measuring process then opens the database cold, which is what makes the cold column meaningful. Copying a real database is possible but only with the owning process stopped, and it is not what the committed baseline used.

```bash
pnpm bench                                  # 20k docs into ./data/bench, 30 iterations, writes docs/perf-baseline.md
BENCH_DOCS=100000 BENCH_RESET=1 pnpm bench  # bigger corpus, rebuilt from scratch
PERF=0 pnpm bench                           # same scenarios with the instrumentation off, to price it
```

`BENCH_DATA_DIR` (default `./data/bench`, gitignored, refuses `./data/pg`), `BENCH_DOCS` (20000), `BENCH_DAYS` (120), `BENCH_SEED`, `BENCH_ITERATIONS` (30), `BENCH_PERSON` (`lula`), `BENCH_TERM` (`reforma`), `BENCH_RESET=1` (rebuild instead of reusing an existing corpus of the same size) and `BENCH_OUT` (default `docs/perf-baseline.md`). The dataset is reused between runs when its doc count already matches, so only the first run pays for generation.

`pnpm test` never runs the benchmark: it asserts that every scenario is still a request the API answers and that the corpus is deterministic, against the shared in-memory fixture, and never asserts a timing.

## HTTP caching

Every `/api/*` GET is public, read-only and depends on data that only changes when `pnpm push` copies a local PGlite into the managed Postgres. So each 200 carries `Cache-Control: public, s-maxage=<window>, stale-while-revalidate=86400`, and on Vercel a CDN hit answers without running a function or touching Supabase — the cheapest read there is on both free plans. The CDN keys on the full URL, query string included, so two different filter sets never share an entry.

| Route | `s-maxage` | Why |
|---|---|---|
| `/api/people` | 24h | The only route with no `now()` in its SQL. It changes when `seed.json` changes, which means an edit, a `pnpm reindex` and a push. |
| `graph`, `sources`, `docs`, `timeline`, `testimony`, `/api/tone` | 6h | Default window `days=30`; 6h is ~1% of it. |
| `rising`, `/api/candidates` | 1h | Default window `days=7` and both are read as "what changed lately"; 1% of 7 days is ~1.7h, rounded down. |

The rule behind the table: an entry may be at most ~1% of the shortest default window the route reports on, capped at a day.

**Staleness, in plain terms.** A reader can see a page up to `s-maxage` old: up to 6 hours on the graph, sources, docs, timeline, testimony and tone views, up to 1 hour on rising and candidates, up to a day on the list of tracked people. Within `stale-while-revalidate` (a day) the CDN may serve one entry that is older still while it refreshes in the background, so the worst case is `s-maxage + swr`. Two visible consequences: (1) documents ingested and pushed in the meantime do not appear yet; (2) the windows are `now() - interval 'N days'`, not calendar days, so at the old edge a document that has just fallen out of a window can still be counted for up to `s-maxage`. On `days=30` that edge moves 0.8% of the window, on `days=7` 0.6%. Both are far smaller than the gap between two `pnpm push` runs, which is the real age of the data.

**What is never cached.** Anything that is not a 200 on a GET gets `Cache-Control: no-store`: the 404 for an unknown person, the 404 for an unknown `/api` path, and any future non-GET method. An uncaught exception is turned into a 500 by Hono's own error handler, which does not pass through this middleware and therefore carries no `Cache-Control` at all; Vercel does not cache a function response that has no `Cache-Control`. Nothing under `public/` is touched — those files are served by the CDN from `vercel.json`, not by this middleware.

There is no `max-age`, on purpose: the directive targets the shared cache. A browser with no `max-age` and no `Last-Modified` has no heuristic freshness to lean on and re-asks the CDN, which answers from its own copy without waking a function.

```bash
API_CACHE_HOURS=6         # graph, sources, docs, timeline, testimony, tone
API_CACHE_TREND_HOURS=1   # rising, candidates
API_CACHE_STATIC_HOURS=24 # people
API_CACHE_SWR_HOURS=24    # stale-while-revalidate; 0 drops the directive
```

Each is read as whole hours, floor 1 (0 for the stale window), ceiling 168 (a week); anything unset or non-numeric falls back to the default above.

**Invalidation.** Vercel scopes the CDN cache per deployment, so a deployment built from new code starts cold and no reader keeps seeing the previous data. That does not happen by itself after `pnpm push`: a push changes rows in Supabase and touches no file here, so nothing triggers a build. Redeploy explicitly (`vercel deploy --prod`, or "Redeploy" in the dashboard **without** "use existing build cache", which is what reuses the previous artefacts) or use the project's *Purge Cache* action. This has not been verified against the production project from this repo; if a no-op redeploy turns out to be deduplicated onto the existing deployment, purge the cache explicitly instead. Until then, the honest guarantee is the one in the header: at most `s-maxage + stale-while-revalidate` after a push, every reader sees the new data.

## Layout

- `src/collectors/*` one collector per source, same signature (Strategy)
- `src/extract.ts` hashtags, words, stopwords, person matching
- `src/store.ts` doc and person inserts, shared by ingest and reindex
- `src/graph.ts` scoring SQL (counts, PMI, term-term links, testimony aggregation)
- `src/scorers/*` one scorer per method, same signature; `src/score.ts` scores unscored `(doc, person)` pairs; `src/export-docs.ts` dumps docs for kikori's training set
- `src/server.ts` Hono API + static UI
- `src/perf.ts` opt-in request/statement instrumentation; `src/bench.ts` the read benchmark runner, `src/bench-writes.ts` the write-path one, `src/bench-corpus.ts` the synthetic corpus both share, `src/bench-scenarios.ts` the read benchmark's request set
- `public/design-5.html` current UI (radial atlas), served at `/`; markup only, plus `public/atlas.css` (shared with `public/compare.html`) and one `<script type="module" src="./js/app.js">`. The side column holds the outlet list, the kikori avaliação panel (`GET /api/people/:id/testimony`: overall, per source, per outlet) and the candidate queue. The page ends with a "Como ler" chapter that explains frequência, PMI, the weighted size, tone and the avaliação. `public/index.html` legacy UI
- `public/js/` the front-end ES modules, no build step: `format.js` (pure helpers and the shared JSDoc types), `api.js` (URLs and fetching), `layout.js` (pure packing/routing geometry), `render.js` (the DOM layer), `state.js` (mutable UI state), `app.js` (wiring, and the `createHandlers` event table the tests import)
- `docs/designs/` archived design alternatives (`design-1..4`, `design-6`, `graph-lab`, `graph-circle-lab`, `designs.html`), kept for reference and not served
- `test/` node:test suites; `test/fixture.ts` seeds the in-memory database
- `seed.json` tracked people and aliases. Longer aliases win over bare ones across people; an optional `exclude` list names lookalikes that must not match ("Ciro Nogueira"). An optional `camaraId` (federal deputy id from `dadosabertos.camara.leg.br`) enables the `camara` collector for that person, and an optional `senadoId` (senator code from `dadosabertos.senado.leg.br`) enables `senado`; a person may carry either, both, or neither, and is skipped by a collector whose id it lacks. Scope: politicians and public figures of the political sphere only. People removed from the seed are pruned on the next `pnpm ingest`; their docs stay as PMI baseline
- `docs/perf-baseline.md` the committed output of `pnpm bench`, the reference the performance work compares against
- `data/` PGlite database (gitignored), including `data/bench/` and `data/bench-writes/`, the benchmarks' own throwaway databases
