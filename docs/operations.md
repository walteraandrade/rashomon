# Operations

Deploying, writing, indexing, measuring and caching. Everything here assumes one rule: PGlite allows one process per data directory, so the server and an `ingest`/`reindex` never share a `DATA_DIR`.

## Environment

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3210` | server port |
| `DATA_DIR` | `./data/pg` | PGlite directory; `memory://` is in-memory and is what tests use |
| `DATABASE_URL` / `POSTGRES_URL` | unset | switches every command to a managed Postgres over `pg` |
| `PG_SSL_CA` | unset | the Postgres server's CA certificate, PEM text (Supabase: Project Settings > Database > SSL configuration > download certificate); required for any non-local `DATABASE_URL`/`POSTGRES_URL` — a missing value stops the connection instead of falling back to an unverified one |
| `PG_POOL_MAX` | `3` | connections per function instance, managed Postgres only |
| `BSKY_HANDLE` / `BSKY_APP_PASSWORD` | unset | authenticated Bluesky, so its collector can paginate |
| `GKG_SLOTS` | `24` | how many 15-minute GDELT slots to look back (24 = 6h) |
| `ANALYZE_MIN_DOCS` | `200` | ingest size from which planner statistics are refreshed |
| `WRITE_BATCH_ROWS` | `500` | rows per insert statement (1..10000) |
| `WRITE_BATCH_DOCS` | `200` | documents per transaction (1..5000) |
| `MIN_PHRASE_COUNT` | `5` | occurrences a word pair needs to enter the phrase lexicon (2..1000000) |
| `MIN_PHRASE_PERCENT` | `35` | stickiness a word pair needs, in percent (1..100) |
| `TESTIMONY_SCORER` | `onnx` | which scorer `pnpm score` runs; `stub` is the hermetic one |
| `TESTIMONY_MODEL` / `TESTIMONY_REVISION` / `TESTIMONY_DTYPE` | kikori / unset / `q8` | the model, its Hub revision and its precision |
| `MODEL_DIR` | `./data/models` | model cache |
| `PERF` | unset | opt-in request instrumentation |
| `API_CACHE_*` | see [HTTP caching](#http-caching) | cache windows in whole hours |

`.env.example` lists these names with empty values; copy it to `.env.local`. `.gitignore` ignores `.env` and `.env.*` and negates `.env.example`, so a real credential file is never trackable. The benchmark-only `BENCH_*` variables stay out of it and are documented with `pnpm bench` below.

## Deploy

`DATABASE_URL` (or `POSTGRES_URL`, what the Vercel Supabase integration injects) switches every command from embedded PGlite to a managed Postgres over `pg`. Without it nothing changes. The serverless filesystem is read-only and short-lived, so a managed database is the only shape that works on Vercel; `api/index.ts` wraps the Hono app and `vercel.json` serves `public/` from the CDN. `PG_SSL_CA` (the Postgres server's CA certificate, PEM text) must be set in Vercel alongside `DATABASE_URL`/`POSTGRES_URL` before a deploy that talks to a non-local database: `poolConfig` refuses to build a connection to any non-local host without it, so a deploy missing the variable fails closed rather than connecting with an unverified chain. `ssl.ca` is `PG_SSL_CA` added to Node's own default trust store, never a replacement for it — `POSTGRES_URL` from the Vercel Supabase integration can point at the pooler host (`aws-0-<region>.pooler.supabase.com`), not `db.<ref>.supabase.co`, and the pooler may serve a publicly-signed certificate that `PG_SSL_CA` alone would fail to verify.

**Rollout order matters.** `api/index.ts` calls `poolConfig` at module load, so a missing `PG_SSL_CA` does not degrade one route — it throws before the function can serve any request. Set the `PG_SSL_CA` secret in both the Vercel project (Settings > Environment Variables) and the GitHub repository secrets (for `.github/workflows/ingest.yml`) *before* merging a change that deploys against a non-local database, not after. Confirm the pooler's chain verifies against the CA you are about to set:

```bash
openssl s_client -connect <host>.pooler.supabase.com:5432 -starttls postgres -CAfile prod-ca.crt </dev/null 2>&1 | grep -E 'Verify return code|subject='
```

```bash
vercel env pull .env.local                       # POSTGRES_URL, POSTGRES_URL_NON_POOLING
export PG_SSL_CA="$(cat prod-ca.crt)"            # nothing here loads .env; poolConfig reads the process environment
export DATABASE_URL=$POSTGRES_URL_NON_POOLING
pnpm migrate                                     # create the schema once
DATA_DIR=./data/pg pnpm push                     # one-way copy of a local PGlite into it
vercel deploy --prod
```

Collectors and scoring do not run on Vercel: run `pnpm ingest`, `reindex` and `score` from a machine with `DATABASE_URL` and `PG_SSL_CA` set, or keep collecting locally and `pnpm push` again (inserts skip rows that already exist). `.github/workflows/ingest.yml` does the collecting on a schedule: every 6 hours GitHub Actions runs `pnpm ingest` against the `DATABASE_URL` repository secret (use `POSTGRES_URL_NON_POOLING`), a `PG_SSL_CA` repository secret (the same PEM CA text `poolConfig` requires), with `BSKY_HANDLE`/`BSKY_APP_PASSWORD` secrets for authenticated Bluesky; the workflow stops before running `pnpm ingest` if either `DATABASE_URL` or `PG_SSL_CA` is missing. Trigger it by hand with `gh workflow run ingest.yml`. `TESTIMONY_DTYPE` and `TESTIMONY_REVISION` have to match between that machine and the deployed environment, or `/testimony` answers empty — see [label drift](testimony.md#label-drift). `PG_POOL_MAX` caps connections per function instance (default 3).

`@huggingface/transformers` is required only by `pnpm score`. Its label logic lives in `src/scorers/method.ts`, which has no imports at all, and `src/query.ts` (the route path `api/index.ts` → `src/server.ts` serves) imports the method labels from there, never from `src/scorers/onnx.ts` — so the deployed `/api` function's import graph never reaches the model loader or the Hub client it dynamic-imports. That import-graph split is what keeps the package out of the deployment: the function bundler only traces what the graph reaches. Measured with `vercel build` on this repo: before this split, `.vercel/output/functions/api/index.func` was 94,327,622 bytes (~90 MB) and carried `onnxruntime-node`, `@huggingface/transformers` and `sharp`; after, it is 18,666,128 bytes (~18 MB) and carries none of them.

It also ships as an `optionalDependencies` entry in `package.json`, not a regular dependency — but that move only signals intent. Vercel installs optional dependencies like any other, so the package still lands in `node_modules` either way; it is the import-graph split above, not this entry, that the deployed function's size depends on. The move has a real cost: if `onnxruntime-node` has no prebuild for a platform, install now succeeds silently, and the failure surfaces later as a confusing dynamic-import error inside `pnpm score`, instead of at install time.

## Bounded downloads

Every unbounded network read in the collector layer is capped, so one oversized or hostile response logs and gets skipped instead of taking the ingest process out with an allocation failure. `src/http.ts` exports `MAX_RESPONSE_BYTES` (32MB), the compressed/wire-size ceiling shared by `slowGet` (`gdelt`, `camara`, `senado`), `gkg.ts`'s zip fetch and `rss.ts`'s feed fetch (and, through it, `juridico`/`oficial`/`nicho`, which reuse `fetchFeed`). Each of them checks a declared `content-length` before reading a single byte of the body, then keeps a running total while streaming so a response with no (or an understated) `content-length` is still caught, without ever resolving a partial body. `gkg.ts` additionally caps the *decompressed* CSV at `MAX_EXPANDED_BYTES` (256MB), enforced while streaming through fflate's `Unzip` — the only collector that unzips anything. Both figures are literals, not environment-overridable: they are safety ceilings picked from measured corpus sizes with headroom, not an operational knob like `GKG_SLOTS`. An oversized GKG slot is skipped without being marked done in `gkg_files`, so the next `gkg()` run retries it — it either succeeds once the size problem clears or ages out of the `GKG_SLOTS` look-back window, exactly like a slot GDELT never published. A `slowGet` caller hitting the cap sees an ordinary rejection, indistinguishable from a timeout, which `gdelt`/`camara`/`senado` already log and skip per person. `rss`/`juridico`/`oficial`/`nicho` fail that one feed's whole fetch, which already fails its collector's `Promise.all` today.

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

## Front-end bootstrapping

The page at `/` is a sequence of independent figures (`src/ui/figures/*.ts`), each with its
own sentence of `<select>`s and its own fetches. `src/ui/app.ts` reads the querystring once,
at mount, to seed them. Nothing is ever written back to `location` or `history`: the controls
change what a figure shows, never the URL.

Two key forms, read in this order:

| Form | Example | Effect |
|---|---|---|
| bare | `?days=7` | seeds every figure that has that control |
| prefixed with the figure id | `?atlas.days=7` | seeds that figure only, and wins over the bare key |

The figure ids are `atlas` (figure 1, `#workspace`), `testimony` (figure 2, `#testimony`) and
`compare` (figure 3, `#compare`). Figure 1 reads `person`, `days`, `source`, `sort` and `limit`;
figure 2 reads `person`, `days` and `source` — it has no sort or limit control, matching what
`narrowToTestimony` and `narrowToSources` already drop. Figure 3 reads `a` (bare fallback
`person`, same as figure 1 and 2's own `person` key), `b`, `days`, `source`, `limit` and
`measure` — `b` and `measure` have no bare equivalent, since no other figure has a second
person or a measure selector.

`/?days=7&testimony.person=tarcisio` therefore puts every figure on a 7-day window and figure 2
on Tarcísio, whoever figure 1 is showing. A key with neither form left undefined lets the
figure's own default stand, exactly as if no querystring were there. An unknown person id falls
back to the first person in `GET /api/people`; figure 3's `b`, when absent or unknown, falls
back to the second distinct person in that same list, or to `a`'s own id when the tracked list
has only one person — making `a === b` a reachable, legal state, not a guarded error. These keys
are client-side only — each figure still narrows its own request through `src/ui/api.ts`, so
nothing here reaches the server verbatim.

`GET /api/people` is fetched exactly once, by the shell, however many figures mount. If it
fails, the failure travels down into every `mount()` as `peopleError` and each figure paints
its own network-failure copy with a retry button. An outage is never reported as an empty
`seed.json`.

## Empty states and the pet

The site draws no borders and spends almost no colour: type carries every limit. One raster
breaks that rule, and it is allowed in exactly two boxes — the two places where there is no
chart on screen for it to compete with.

| Box | Painter | Sprite | Copy it sits beside |
|---|---|---|---|
| an empty recorte in figure 2 | `paintTestimony` (`render.ts`) | `pet-caracara.png`, 106×78 | "Nenhum texto avaliado neste recorte… Tente um período maior ou outra fonte." |
| the atlas with nothing to draw | `OUTAGE` (`figures/atlas.ts`) | `pet-caracara-perched.png`, 26×37 | "Falha de rede ou base indisponível. Nenhum grafo fictício será exibido." |

Four rules hold it there, and `test/pet-acceptance.test.ts` pins each one:

- **One bird at a time.** `paintOutlets` empties in the same breath as `paintTestimony`, so the
  outlet list stays plain text; figures 2 and 3 print the `peopleError` outage in words, because
  all three figures fail together and three birds read as decoration rather than as one failure.
- **It leaves when the data arrives.** A recorte with a score paints no `<img>` at all. Nothing
  on this page may sit next to a number a reader is reading.
- **Integer scales only.** `atlas.css` gives each sprite a width that is a whole multiple of its
  own grid (106×78 and 52×74), the `<img>` carries that same size so the box cannot grow under
  the reader, and `.pet` sets `image-rendering: pixelated`. A pixel sprite at a fractional scale,
  or smoothed, is a blurred sprite.
- **It is a state, never furniture.** Neither `design-5.html` nor `como-ler.html` may mention
  `pet-caracara`: the sprite exists only where a painter decides it should.

`OUTAGE` covers both of figure 1's ways into that box — a failed `GET /api/people` and a failed
graph fetch. They carry identical copy, so painting only one of them would show the bird
sometimes and not others for what a reader sees as the same box. An empty `seed.json` still
paints no bird: nobody tracked is a different fact from nothing answering.

Both files sit under `public/` and are served by the static handler like any other asset. They
are quantised to the site's own palette tokens — seven colours in the flying sprite, six in the
perched one, no hue outside `--cmp-b` — which is why they weigh 3 KB and 533 bytes.

## HTTP caching

Every `/api/*` GET is public, read-only and depends on data that only changes when `pnpm push` copies a local PGlite into the managed Postgres. So each 200 carries `Cache-Control: public, s-maxage=<window>, stale-while-revalidate=86400`, and on Vercel a CDN hit answers without running a function or touching Supabase — the cheapest read there is on both free plans. The CDN keys on the full URL, query string included, so two different filter sets never share an entry.

| Route | `s-maxage` | Why |
|---|---|---|
| `/api/people` | 24h | The only route with no `now()` in its SQL. It changes when `seed.json` changes, which means an edit, a `pnpm reindex` and a push. |
| `graph`, `sources`, `docs`, `timeline`, `testimony`, `/api/tone`, `/api/compare` | 6h | Default window `days=30`; 6h is ~1% of it. |
| `rising`, `/api/candidates` | 1h | Default window `days=7` and both are read as "what changed lately"; 1% of 7 days is ~1.7h, rounded down. |

The rule behind the table: an entry may be at most ~1% of the shortest default window the route reports on, capped at a day.

**Staleness, in plain terms.** A reader can see a page up to `s-maxage` old: up to 6 hours on the graph, sources, docs, timeline, testimony, tone and compare views, up to 1 hour on rising and candidates, up to a day on the list of tracked people. Within `stale-while-revalidate` (a day) the CDN may serve one entry that is older still while it refreshes in the background, so the worst case is `s-maxage + swr`. Two visible consequences: (1) documents ingested and pushed in the meantime do not appear yet; (2) the windows are `now() - interval 'N days'`, not calendar days, so at the old edge a document that has just fallen out of a window can still be counted for up to `s-maxage`. On `days=30` that edge moves 0.8% of the window, on `days=7` 0.6%. Both are far smaller than the gap between two `pnpm push` runs, which is the real age of the data.

**What is never cached.** Anything that is not a 200 on a GET gets `Cache-Control: no-store`: the 404 for an unknown person, the 404 for an unknown `/api` path, and any future non-GET method. An uncaught exception is turned into a 500 by Hono's own error handler, which does not pass through this middleware and therefore carries no `Cache-Control` at all; Vercel does not cache a function response that has no `Cache-Control`. Nothing under `public/` is touched — those files are served by the CDN from `vercel.json`, not by this middleware.

There is no `max-age`, on purpose: the directive targets the shared cache. A browser with no `max-age` and no `Last-Modified` has no heuristic freshness to lean on and re-asks the CDN, which answers from its own copy without waking a function.

```bash
API_CACHE_HOURS=6         # graph, sources, docs, timeline, testimony, tone, compare
API_CACHE_TREND_HOURS=1   # rising, candidates
API_CACHE_STATIC_HOURS=24 # people
API_CACHE_SWR_HOURS=24    # stale-while-revalidate; 0 drops the directive
```

Each is read as whole hours, floor 1 (0 for the stale window), ceiling 168 (a week); anything unset or non-numeric falls back to the default above.

**Invalidation.** Vercel scopes the CDN cache per deployment, so a deployment built from new code starts cold and no reader keeps seeing the previous data. That does not happen by itself after `pnpm push`: a push changes rows in Supabase and touches no file here, so nothing triggers a build. Redeploy explicitly (`vercel deploy --prod`, or "Redeploy" in the dashboard **without** "use existing build cache", which is what reuses the previous artefacts) or use the project's *Purge Cache* action. This has not been verified against the production project from this repo; if a no-op redeploy turns out to be deduplicated onto the existing deployment, purge the cache explicitly instead. Until then, the honest guarantee is the one in the header: at most `s-maxage + stale-while-revalidate` after a push, every reader sees the new data.

