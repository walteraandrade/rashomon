# rashomon

Rashomon: which words a Brazilian political figure is associated with, across Bluesky, Google News, GDELT and RSS feeds. MVP.

## Run

```bash
pnpm install
pnpm ingest          # default sources: bluesky, rss, gnews, gkg; or: pnpm ingest gkg
pnpm ingest gdelt    # GDELT DOC API, slow and rate limited, off by default
pnpm dev             # http://localhost:3210
pnpm reindex         # recompute terms and person matches after changing extract.ts or seed.json
pnpm typecheck       # tsc
pnpm test            # node:test against an in-memory database
```

`PORT` sets the server port (default 3210). `DATA_DIR` sets the PGlite directory (default `./data/pg`); `memory://` is in-memory and is what tests use. PGlite allows one process per directory: stop the server before `ingest` or `reindex`.

Bluesky without login returns one page (100 posts) per person. To paginate, set `BSKY_HANDLE` and `BSKY_APP_PASSWORD` (app password, not the account password).

`gnews` reads Google News RSS search per person (100 headlines each, Brazil, pt-BR).

`gkg` downloads GDELT's 15-minute translation GKG files (`*.translation.gkg.csv.zip`), keeps Portuguese rows, uses the original page title as text and GDELT themes as `theme` terms. Processed slots are recorded in `gkg_files`, so each run only fetches new ones. `GKG_SLOTS` sets how many recent slots to look back (default 24 = 6h, ~3.5MB each). A slot is marked done before its docs are inserted; if the insert fails you must delete the row from `gkg_files` to retry it.

`gdelt` (DOC API) enforces ~1 request / 5s per IP and returns 429 aggressively. Off by default.

## API

`GET /api/people`

`GET /api/people/:id/graph?days=30&source=all|bluesky|gdelt|rss|gnews|gkg&kind=all|hashtag|word|theme&sort=count|pmi&limit=40&min=2`

Add `domain=<host>` to restrict the graph to one outlet (or one Bluesky handle).

`GET /api/people/:id/sources?days=30&source=all` lists outlets that mention the person: `domain`, `source`, `docs`, `tone` (average GDELT tone, null when unknown), `tone_n`.

`GET /api/people/:id/docs?term=&kind=all|hashtag|word|theme&days=30&source=all|bluesky|gdelt|rss|gnews|gkg&domain=all&limit=50&offset=0` lists the docs behind a graph term (or every doc about the person when `term` is omitted): `{ total, docs }`, each doc `{ id, source, domain, published_at, text, uri, tone }`, newest first. `term` matches normalized tokens exactly, not substrings.

Returns `{ person, stats, nodes, links }`. Each node also carries `tone`: average GDELT tone of the docs where the term co-occurs with the person, null when no GDELT doc contributed. `pmi` is log2 of how much more often the term co-occurs with the person than chance, measured against every collected doc in the window.

## Domain and tone

Every doc stores `domain`: outlet host for news (`gnews` uses the `<source>` element, not the Google redirect link), author handle for Bluesky. `tone` comes only from GDELT GKG (V2Tone, first field, roughly -10..+10; political news sits around -1). Other sources have `tone = null`. Outlet names are stripped from Google News text so they do not become terms.

`pnpm purge <source>` deletes that source's docs (and resets `gkg_files` for `gkg`), for a clean re-fetch.

## Layout

- `src/collectors/*` one collector per source, same signature (Strategy)
- `src/extract.ts` hashtags, words, stopwords, person matching
- `src/store.ts` doc and person inserts, shared by ingest and reindex
- `src/graph.ts` scoring SQL (counts, PMI, term-term links)
- `src/server.ts` Hono API + static UI
- `public/design-5.html` current UI (radial atlas); `public/index.html` legacy UI; other `design-*.html` kept for reference
- `test/` node:test suites; `test/fixture.ts` seeds the in-memory database
- `seed.json` tracked people and aliases. Scope: politicians and public figures of the political sphere only. People removed from the seed are pruned on the next `pnpm ingest`; their docs stay as PMI baseline
- `data/` PGlite database (gitignored)
