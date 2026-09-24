# API reference

Every route is a public, read-only `GET` under `/api`. Query parameters are parsed and clamped in `src/query.ts`; responses are cached at the CDN, see [operations](operations.md#http-caching). `days` is the one parameter that is not clamped but [enumerated](#the-window-days).

| Route | Returns |
| --- | --- |
| `/api/people` | every tracked person |
| `/api/people/:id/graph` | the atlas: `{ person, stats, nodes, links, signature, outlets }` |
| `/api/people/:id/sources` | outlets that mention the person |
| `/api/people/:id/docs` | the documents behind a term |
| `/api/people/:id/rising` | terms rising against a baseline window |
| `/api/people/:id/timeline` | doc counts per bucket |
| `/api/people/:id/week` | top terms per calendar day in Brazil |
| `/api/people/:id/testimony` | kikori scores, overall and per outlet |
| `/api/tone` | GDELT tone per (person, outlet), across everybody |
| `/api/candidates` | untracked names worth adding to `seed.json` |
| `/api/compare` | exact count/PMI/tone for two people, over the union of their strongest terms |

The contract is stable: `/api/people`, `/api/people/:id/graph` and `/api/people/:id/sources` never lose a field. A new capability is a new route or a new optional parameter, never a breaking change to an existing one.

## The window (`days`)

`days` takes one of three values: **7**, **30** or **365** — the same three windows every period `<select>` on the site offers. Any other number snaps to the nearest one, ties going to the shorter window: `?days=18` reads as 7, `?days=19` as 30, `?days=197` as 30, `?days=198` as 365, and anything above 365 as 365. A missing or non-numeric value still falls back to the route's own default (30, or 7 on `rising` and `candidates`), so a caller that sends no `days` sees exactly what it always did.

This is a deliberate narrowing of the old `[1, 365]` clamp (issue #111). The API is public and unauthenticated, and the CDN keys on the full query string, so a free-form `days` was 365 distinct cache entries per person per filter set, each miss a cold function invocation and a real query. Three windows is a surface the cache can actually cover. A caller that used to ask for `?days=45` now gets the 30-day answer, and the response says which window it used wherever it reports one (`rising`, `candidates`, `compare`).

## Enumerated integers (`limit`, `min`, `baseline`, `offset`)

The same reasoning narrows the other integer parameters (issue #127). Each one takes a value from a short list and any other number snaps to the nearest one, ties going to the smaller; a missing or non-numeric value falls back to the route's own default, which is always in the list.

- `limit`: **1**, **5**, **8**, **12**, **18**, **20**, **24**, **30**, **40**, **50**, **60**, **100** or **200** — every value the page sends (the atlas offers 12/18/24, the ruler 20/40/60/100, the docs card asks for 5, the candidates panel for 30), every route default (40 on `graph`, `compare` and `rising`, 50 on `docs` and `candidates`, 8 on `week`), 1 for "just the top term" and 200 for everything. `rising` and `compare` stop at **100**: each unioned compare key costs two exact figures instead of one, so their ceiling stays where issue #93 put it, and `?limit=200` reads as 100 there. Inserting **8** for `week` moved the snap neighbours of the values around it on every route that reads `LIMITS` or `SMALL_LIMITS`, not just `week`: `?limit=7`, previously 5, now reads as 8; `?limit=9` and `?limit=10`, previously 12, now both read as 8 (10 sits exactly between 8 and 12, and a tie goes to the smaller); `?limit=6` is still closer to 5 and reads unchanged.
- `min`: **1**, **2**, **3** or **5** — the page sends 2 on `graph` and 3 on `candidates`; the defaults are 2 (`graph`), 3 (`rising`, `testimony`, `tone`) and 5 (`candidates`); 1 is "no floor". `?min=4` reads as 3, `?min=1000` as 5.
- `baseline` (`rising`): **30**, the only value. Nothing on the page sends it; the parameter stays in the contract so a caller that sends it still gets an answer, but the answer is the 30-day baseline.
- `offset` (`docs`): a multiple of **50**, from **0** up to **1000**. Nothing on the page pages; a script that walks a term's documents pages 50 at a time, and `?offset=26` reads as 50.

Before this the ranges were `[1, 200]`, `[1, 1000]`, `[1, 365]` and `[0, 1000000]`, which multiplied into millions of reachable cache keys per person and window.

## Shared filters

`source`, `kind`, `domain` and `lean` each take a comma-separated list, matching a doc whose value is any of the listed ones. Unknown tokens are dropped silently, duplicates collapse, and an empty or all-invalid list falls back to `all`. A single token behaves exactly as it always did.

- `source`: `bluesky`, `gdelt`, `rss`, `gnews`, `gkg`, `camara`, `senado`, `juridico`, `oficial`, `nicho`. See [sources](sources.md).
- `kind`: `hashtag`, `word`, `phrase`. The atlas at `/` sends `word,hashtag,phrase`, the full set.
- `domain`: one outlet host, or one Bluesky author handle.
- `lean`: `left`, `right`, `center`, additive on `graph`, `docs`, `rising`, `timeline` and `sources`. See [editorial lean](terms.md#editorial-lean).

`domain` and `lean` intersect: when both are given, only docs whose domain satisfies `domain` *and* is labeled with one of the requested `lean` values are counted; an empty intersection returns zero docs, not `all`.

## graph

`GET /api/people/:id/graph?days=30&source=all&kind=all&domain=all&lean=all&sort=count|pmi&limit=40&min=2`

Returns `{ person, stats, nodes, links, signature, outlets }`. With `domain=all`, `lean=all` and a single `source` the counts come from the precomputed window tables when they exist (see [graph aggregates](operations.md#graph-aggregates)); any other scope, or a window never built, runs the live statement. The response is the same either way. Each node also carries `tone`: average GDELT tone of the docs where the term co-occurs with the person, null when no GDELT doc contributed. `pmi` is log2 of how much more often the term co-occurs with the person than chance, measured against the docs in the window that mention at least one tracked person (see [the PMI universe](terms.md#the-pmi-universe)). `outlets` is `{ domain, lean, basis }[]`, empty when `lean` is unset/`all`, otherwise every `outlets.json` entry matching the resolved `domain`+`lean` scope. `nodes` is ordered by `sort` desc, then `term` asc, then `kind` asc: a term is a `(term, kind)` pair, so the same text can appear under two kinds, and `kind` is what ranks those against each other when everything else ties. `links` carries the person spokes in `nodes` order, then the term-term pairs ordered by `source` then `target`.

`sort=pmi` orders by `pmi * ln(1 + count)`, on purpose, so rare terms do not dominate. Do not change it without a test.

`signature` holds at most 5 rows of `{ term, kind, count, pmi }` (no `tone`): the terms whose count clears `max(3, 5% of stats.about)`, ordered by `pmi` desc then `term` asc then `kind` asc, computed over the same `days`/`source`/`domain` scope as the graph but ignoring `kind`, `min`, `limit` and `sort`, so it is not guaranteed to be a subset of `nodes`.

### `testimony=1`

`GET /api/people/:id/graph?…&testimony=1` adds, to the same response, `stats.testimony = { method, score, n }` (the person's mean score over the docs in scope, so it follows `domain`/`lean`, unlike `/testimony`) and `testimony: { score, n } | null` on every node: the mean score of the in-scope docs that carry the term, `null` when none has a non-null score. `method` resolves exactly as on `/testimony`. Without `testimony=1` nothing is added and the response is byte-for-byte what it was. The atlas always sends it and uses it for the "Colorir por avaliação" mask, which colours each word by its distance from the person's own mean rather than from zero, so the name prior cancels out.

## sources

`GET /api/people/:id/sources?days=30&source=all&domain=all&lean=all` lists outlets that mention the person: `domain`, `source`, `docs`, `tone` (average GDELT tone, null when unknown), `tone_n`, `lean` and `basis` (both `null` when the domain is absent from `outlets.json`).

## docs

`GET /api/people/:id/docs?term=&kind=all&days=30&source=all&domain=all&lean=all&limit=50&offset=0&day=` lists the docs behind a graph term (or every doc about the person when `term` is omitted): `{ total, docs, outlets }`, each doc `{ id, source, domain, published_at, text, uri, tone }`, newest first. `term` matches normalized tokens exactly, not substrings. `outlets` follows the same rule as `graph`'s.

`day` is optional. A doc's calendar day is its `published_at` converted to `America/Sao_Paulo`, except that a `published_at` after the end of today BRT counts as today — the same fold `/week` applies to its own last bucket. So `day=<today's BRT date>` returns today's docs plus every future-dated one, while `day=<any earlier date>` returns the docs whose BRT date is that day and that also fall inside the `days` window — `day` intersects the window, it does not replace it, so the oldest admissible date can come back partial, missing whatever in that calendar day falls before the window's edge. The fold is deliberate: it is what keeps a `/week` bucket's `about` equal to `/docs?day=<that bucket's date>`'s `total` for today's bucket, the invariant issue #150's click from one into the other depends on; a past bucket needs no fold to already agree.

A value that is missing, malformed, not `YYYY-MM-DD`, not a real calendar day (`2026-02-31`), entirely before the `days` window, or a calendar date after today parses to empty. An empty `day` is not a request for the empty day: the route falls back to behaving exactly as it did before `day` existed, so a caller sending a bad date gets the *whole* `days` window back, not zero docs. The response fields do not change.

## rising

`GET /api/people/:id/rising?days=7&baseline=30&kind=all&source=all&domain=all&lean=all&limit=40&min=3` returns `{ days, baseline, terms, present, outlets, about }`, each term `{ term, kind, count_recent, count_baseline, count_recent_raw, count_baseline_raw, lift }` (no `tone`). `count_recent`/`count_baseline` are raw doc counts turned into per-day rates rounded to 2 decimals; `count_recent_raw`/`count_baseline_raw` are the raw counts behind them, exact integers rather than rounded rates. The baseline window is the `baseline` days immediately preceding the recent window, never overlapping it. `lift` is `(count_recent_raw / days) / ((count_baseline_raw + 1) / baseline)`, a pinned formula, not to be changed without a test.

`terms` holds the `limit` highest lifts, ordered by `lift` desc, then `term` asc, then `kind` asc, as it always has. `present` is additive: the `limit` **most present** terms of the recent window (picked by `count_recent_raw` desc, ties by `lift` desc, `term`, `kind`), same row shape, same lift order. A set chosen by lift is the top of one tail, so on a ruler it could only ever sit on one side; the page rules by `present` and lists, below the ruler, what `terms` holds beyond it (with `lift > 1`). The two lists overlap whenever a most-present term is also a highest lift; at or above the number of qualifying terms they are identical.

`about` is `{ recent, baseline, words_recent, words_baseline }`: `about.recent`/`about.baseline` count the distinct docs naming the person in each window (same `source`/`domain`/`lean` scope as `terms`, not filtered by `kind`); `words_recent`/`words_baseline` total the `doc_terms` rows behind every term of each window, **before** `min` and `limit` (same `kind` filter and name exclusion as the terms themselves, so `words_baseline` also counts baseline-only terms that never reach `terms` or `present`), so a caller can compare a term's *share* of everything written about the person, `count_recent_raw / about.words_recent` against `(count_baseline_raw + 1) / about.words_baseline`, which is what the page's ruler positions by. Shares rather than doc counts because a corpus whose docs grow longer (a feed that starts shipping full text) inflates every term's `lift` at once while the person's own doc count stays put. `limit`'s default is **40** (raised from 20).

## timeline

`GET /api/people/:id/timeline?term=&kind=all&days=30&source=all&domain=all&lean=all&bucket=week|day` returns a bare JSON array of `{ bucket_start, count }` (no `tone`, no `outlets` — this route's contract stays a bare array), oldest bucket first, `ceil(days / bucket_days)` items. Buckets are rolling windows counted backward from query time, not calendar/ISO weeks; the oldest bucket is clamped to the window edge so counts sum exactly to `/docs`'s `total` for the same `term`/`kind`/`days`/`source`/`domain`/`lean`.

## week

`GET /api/people/:id/week?days=7&source=all&kind=all&domain=all&lean=all&limit=8` returns `{ days, tz, buckets }`. `tz` is always `"America/Sao_Paulo"`. `buckets` has exactly `days` rows, oldest first: each `{ start, about, terms }`, `start` the midnight that opens that calendar day in Brazil, `about` the docs naming the person that BRT day (not filtered by `kind`), `terms` the top `limit` `(term, kind)` pairs that day by count desc then term then kind. Own-name words and phrases that carry one are dropped the way `/graph` drops them. A day with no about-docs is present as `{ about: 0, terms: [] }`. A `published_at` after the end of today BRT counts in today's bucket.

The span is today in BRT and the `days-1` calendar days before it, not `now() - interval`. A doc inside the rolling window of `/timeline` or `/docs` but on the eighth BRT date is out of `/week`. The sum of `about` is therefore not required to equal `/docs`'s `total` for the same `days`. No `tone`, no `pmi`, no `outlets`, no `lift`. `source` / `kind` / `domain` / `lean` parse as on `/graph` (comma lists); `kind` filters terms only. Cached with the rolling 6h class, not the 1h trend class.

### `testimony=1` on `/week`

`GET /api/people/:id/week?…&testimony=1` adds `testimony: { score, n } | null` to every bucket: the day's mean kikori score, over the same scope (`source`/`domain`/`lean`, not `kind` — testimony describes docs naming the person that day, not term co-occurrence) `about` already uses, docs with a null score excluded from both the mean and `n`. A day with no scored docs (whether `about` is 0 or every score is null) gets `testimony: null`, never `{ score: null, n: 0 }`. `method` resolves exactly as on `/testimony`: the same charset check, then the same shared default. Without `testimony=1` nothing is added and the response is byte-for-byte what it was — no `testimony` key on any bucket, not even `null`. No week-level or `stats`-level summary is added; the page already has the person's mean from `/graph`'s `stats.testimony` or from `/testimony`'s `overall`. `n` is returned raw, uncapped: the `MASK_MIN` floor is a client-side paint decision (`src/ui/format.ts`), not enforced here.

## testimony

`GET /api/people/:id/testimony?days=30&source=all&method=kikori:q8&min=3` returns `{ method, overall, by_source, by_domain }`, a second, source-agnostic signal scored -10..+10 per `(doc, person)` by a pluggable scorer, stored separately from and never merged with GDELT's `tone`. `overall` is `{ score, n }` averaged over every doc scored under `method` in the window, no floor. `by_source` lists one `{ source, score, n }` row per source with at least one non-null score (no `min` floor). `by_domain` lists one `{ domain, source, score, n }` row per `(domain, source)` pair with `n >= min`; a doc with no resolvable `domain` never appears here, though it still counts in `overall`/`by_source`. `method` reads whatever rows exist in `doc_testimony` for that label, including a retired scorer's; an unscored `method` returns `{ score: null, n: 0 }` everywhere, not a 404.

When `?method` is omitted or fails its charset check it resolves through the same `methods` map `pnpm score` uses — which depends on env vars that must match between the scoring machine and the server. See [testimony](testimony.md#label-drift) for that failure mode.

## tone

`GET /api/tone?days=30&min=3` returns `{ persons, domains, cells }` across every tracked person (not nested under `/people/:id`). `persons` is `{ id, name }` for every row in `persons`, ordered by name, present even with zero cells. `domains` is the sorted distinct set of domains that appear in `cells` (a domain that never clears `min` never appears). `cells` holds one `{ person_id, domain, tone, n }` row per `(person, domain)` pair with at least `min` toned docs in the window; `tone` is the average, rounded to 2 decimals, `n` is the toned-doc count. [Tone is GDELT-only](terms.md#domain-and-tone), so non-GDELT docs never contribute to `tone` or `n` here.

## candidates

`GET /api/candidates?days=7&min=5&limit=50` returns `{ days, candidates }`: person names nobody tracks yet, ranked by doc count in the window. Each candidate is `{ name, count, sources, previous, samples }`: `count` is distinct docs in the window, `sources` distinct sources, `previous` the count in the window of the same length immediately before (so a caller sees what is rising), `samples` up to 3 `{ id, source, text }` docs, newest first. Cross-person by construction, not nested under `/people/:id`. Promotion stays human: add the name to `seed.json` and run `pnpm reindex`. See [how names are discovered](terms.md#candidate-discovery).

## compare

`GET /api/compare?a=<personId>&b=<personId>&days=30&source=all&domain=all&lean=all&kind=all&limit=40` returns exact figures for two tracked people over the union of their strongest terms — never a zero standing in for "not in that person's top list". Not nested under `/people/:id`, like `/tone` and `/candidates`: it spans two specific people, neither of which is "the" resource. `a` is resolved before `b`; a missing or unknown id on either side returns 404 with `{ "error": "person not found" }`, the same shape the `/people/:id/*` middleware uses — with both invalid, the body cannot say which. `a === b` is legal: both sides are computed independently and come back identical.

Returns `{ days, a, b, terms }`. `a`/`b` are each `{ person, about }`: `person` is `{ id, name, aliases }`, `about` is that side's `stats.about` under the same meaning `/graph` uses (docs in scope naming that person, unfiltered by term or kind). `terms` holds one row per unioned `(term, kind)` key, `{ term, kind, a, b }`, ordered by `term` asc then `kind` asc. Each side's value is one of: `{ count, pmi, tone }` (an exact figure, computed the same way `/graph`'s node figures are), `null` (measured: zero documents on that side carry the term in scope), or the string `"name"` (hidden because the term is, or contains, that side's own name word, per `nameTokens` — never computed for that side, exactly like `/graph` drops a person's own name from its `nodes`). A term can read `"name"` for one side and a real figure for the other.

There is no `min`: a term present for one side and absent for the other is exactly what this route must keep as a measured `null`, so a floor tied to one side's count cannot apply symmetrically. `limit` caps how many `(term, kind)` keys enter the union, not the figures themselves: per side, the top `limit` terms by count desc and the top `limit` terms by `pmi * ln(1 + count)` desc (the pinned `sort=pmi` formula) are unioned across both sides — up to four lists' worth of keys — and every key in that union gets its exact, uncapped figure looked up on each side. No `links`, `signature` or `outlets`: this route answers one question and nothing else.
