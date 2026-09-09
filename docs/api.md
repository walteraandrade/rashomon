# API reference

Every route is a public, read-only `GET` under `/api`. Query parameters are parsed and clamped in `src/query.ts`; responses are cached at the CDN, see [operations](operations.md#http-caching).

| Route | Returns |
| --- | --- |
| `/api/people` | every tracked person |
| `/api/people/:id/graph` | the atlas: `{ person, stats, nodes, links, signature, outlets }` |
| `/api/people/:id/sources` | outlets that mention the person |
| `/api/people/:id/docs` | the documents behind a term |
| `/api/people/:id/rising` | terms rising against a baseline window |
| `/api/people/:id/timeline` | doc counts per bucket |
| `/api/people/:id/testimony` | kikori scores, overall and per outlet |
| `/api/tone` | GDELT tone per (person, outlet), across everybody |
| `/api/candidates` | untracked names worth adding to `seed.json` |

The contract is stable: `/api/people`, `/api/people/:id/graph` and `/api/people/:id/sources` never lose a field. A new capability is a new route or a new optional parameter, never a breaking change to an existing one.

## Shared filters

`source`, `kind`, `domain` and `lean` each take a comma-separated list, matching a doc whose value is any of the listed ones. Unknown tokens are dropped silently, duplicates collapse, and an empty or all-invalid list falls back to `all`. A single token behaves exactly as it always did. `rising` and `timeline` still take a single `source` value.

- `source`: `bluesky`, `gdelt`, `rss`, `gnews`, `gkg`, `camara`, `senado`, `juridico`, `oficial`, `nicho`. See [sources](sources.md).
- `kind`: `hashtag`, `word`, `theme`, `phrase`. The atlas at `/` sends `word,hashtag,phrase`, so GDELT's own theme codes stay out of the map by default; they remain in the API and in `atlas-legacy.html`.
- `domain`: one outlet host, or one Bluesky author handle.
- `lean`: `left`, `right`, `center`, additive on `graph`, `docs`, `rising`, `timeline` and `sources`. See [editorial lean](terms.md#editorial-lean).

`domain` and `lean` intersect: when both are given, only docs whose domain satisfies `domain` *and* is labeled with one of the requested `lean` values are counted; an empty intersection returns zero docs, not `all`.

## graph

`GET /api/people/:id/graph?days=30&source=all&kind=all&domain=all&lean=all&sort=count|pmi&limit=40&min=2`

Returns `{ person, stats, nodes, links, signature, outlets }`. Each node also carries `tone`: average GDELT tone of the docs where the term co-occurs with the person, null when no GDELT doc contributed. `pmi` is log2 of how much more often the term co-occurs with the person than chance, measured against the docs in the window that mention at least one tracked person (see [the PMI universe](terms.md#the-pmi-universe)). `outlets` is `{ domain, lean, basis }[]`, empty when `lean` is unset/`all`, otherwise every `outlets.json` entry matching the resolved `domain`+`lean` scope. `nodes` is ordered by `sort` desc, then `term` asc, then `kind` asc: a term is a `(term, kind)` pair, so the same text can appear under two kinds, and `kind` is what ranks those against each other when everything else ties. `links` carries the person spokes in `nodes` order, then the term-term pairs ordered by `source` then `target`.

`sort=pmi` orders by `pmi * ln(1 + count)`, on purpose, so rare terms do not dominate. Do not change it without a test.

`signature` holds at most 5 rows of `{ term, kind, count, pmi }` (no `tone`): the terms whose count clears `max(3, 5% of stats.about)`, ordered by `pmi` desc then `term` asc then `kind` asc, computed over the same `days`/`source`/`domain` scope as the graph but ignoring `kind`, `min`, `limit` and `sort`, so it is not guaranteed to be a subset of `nodes`.

### `testimony=1`

`GET /api/people/:id/graph?…&testimony=1` adds, to the same response, `stats.testimony = { method, score, n }` (the person's mean score over the docs in scope, so it follows `domain`/`lean`, unlike `/testimony`) and `testimony: { score, n } | null` on every node: the mean score of the in-scope docs that carry the term, `null` when none has a non-null score. `method` resolves exactly as on `/testimony`. Without `testimony=1` nothing is added and the response is byte-for-byte what it was. The atlas always sends it and uses it for the "Colorir por avaliação" mask, which colours each word by its distance from the person's own mean rather than from zero, so the name prior cancels out.

## sources

`GET /api/people/:id/sources?days=30&source=all&domain=all&lean=all` lists outlets that mention the person: `domain`, `source`, `docs`, `tone` (average GDELT tone, null when unknown), `tone_n`, `lean` and `basis` (both `null` when the domain is absent from `outlets.json`).

## docs

`GET /api/people/:id/docs?term=&kind=all&days=30&source=all&domain=all&lean=all&limit=50&offset=0` lists the docs behind a graph term (or every doc about the person when `term` is omitted): `{ total, docs, outlets }`, each doc `{ id, source, domain, published_at, text, uri, tone }`, newest first. `term` matches normalized tokens exactly, not substrings. `outlets` follows the same rule as `graph`'s.

## rising

`GET /api/people/:id/rising?days=7&baseline=30&kind=all&source=all&domain=all&lean=all&limit=20&min=3` returns `{ days, baseline, terms, outlets }`, each term `{ term, kind, count_recent, count_baseline, lift }` (no `tone`). `count_recent`/`count_baseline` are raw doc counts turned into per-day rates rounded to 2 decimals; the baseline window is the `baseline` days immediately preceding the recent window, never overlapping it. `lift` is `(count_recent_raw / days) / ((count_baseline_raw + 1) / baseline)`, a pinned formula, not to be changed without a test. Rows are ordered by `lift` desc, then `term` asc, then `kind` asc.

## timeline

`GET /api/people/:id/timeline?term=&kind=all&days=30&source=all&domain=all&lean=all&bucket=week|day` returns a bare JSON array of `{ bucket_start, count }` (no `tone`, no `outlets` — this route's contract stays a bare array), oldest bucket first, `ceil(days / bucket_days)` items. Buckets are rolling windows counted backward from query time, not calendar/ISO weeks; the oldest bucket is clamped to the window edge so counts sum exactly to `/docs`'s `total` for the same `term`/`kind`/`days`/`source`/`domain`/`lean`.

## testimony

`GET /api/people/:id/testimony?days=30&source=all&method=kikori:q8&min=3` returns `{ method, overall, by_source, by_domain }`, a second, source-agnostic signal scored -10..+10 per `(doc, person)` by a pluggable scorer, stored separately from and never merged with GDELT's `tone`. `overall` is `{ score, n }` averaged over every doc scored under `method` in the window, no floor. `by_source` lists one `{ source, score, n }` row per source with at least one non-null score (no `min` floor). `by_domain` lists one `{ domain, source, score, n }` row per `(domain, source)` pair with `n >= min`; a doc with no resolvable `domain` never appears here, though it still counts in `overall`/`by_source`. `method` reads whatever rows exist in `doc_testimony` for that label, including a retired scorer's; an unscored `method` returns `{ score: null, n: 0 }` everywhere, not a 404.

When `?method` is omitted or fails its charset check it resolves through the same `methods` map `pnpm score` uses — which depends on env vars that must match between the scoring machine and the server. See [testimony](testimony.md#label-drift) for that failure mode.

## tone

`GET /api/tone?days=30&min=3` returns `{ persons, domains, cells }` across every tracked person (not nested under `/people/:id`). `persons` is `{ id, name }` for every row in `persons`, ordered by name, present even with zero cells. `domains` is the sorted distinct set of domains that appear in `cells` (a domain that never clears `min` never appears). `cells` holds one `{ person_id, domain, tone, n }` row per `(person, domain)` pair with at least `min` toned docs in the window; `tone` is the average, rounded to 2 decimals, `n` is the toned-doc count. [Tone is GDELT-only](terms.md#domain-and-tone), so non-GDELT docs never contribute to `tone` or `n` here.

## candidates

`GET /api/candidates?days=7&min=5&limit=50` returns `{ days, candidates }`: person names nobody tracks yet, ranked by doc count in the window. Each candidate is `{ name, count, sources, previous, samples }`: `count` is distinct docs in the window, `sources` distinct sources, `previous` the count in the window of the same length immediately before (so a caller sees what is rising), `samples` up to 3 `{ id, source, text }` docs, newest first. Cross-person by construction, not nested under `/people/:id`. Promotion stays human: add the name to `seed.json` and run `pnpm reindex`. See [how names are discovered](terms.md#candidate-discovery).
