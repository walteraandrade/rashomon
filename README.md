# rashomon — which words stick to a Brazilian political figure

Rashomon collects what Bluesky, Google News, GDELT, the press and the two houses of Congress say about a tracked politician, then draws the words that keep landing next to that name — how often, how surprising, from which outlet, in what tone.

Live at [rashomon-five.vercel.app](https://rashomon-five.vercel.app). Node + TypeScript, Hono, PGlite, and a front-end of plain ES modules with no build step.

![the atlas](docs/screenshots/atlas-hero.png)

## Quick start

```bash
pnpm install
pnpm ingest    # collect from the default sources
pnpm dev       # http://localhost:3210
```

`pnpm ingest` writes into a local PGlite database at `./data/pg`. PGlite allows one process per directory, so stop the server before ingesting again.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm ingest [source...]` | collect; no argument runs every default source, see [sources](docs/sources.md) |
| `pnpm dev` | serve the API and `public/` on `PORT` (default 3210) |
| `pnpm reindex` | recompute terms, phrases, person matches and candidates from stored docs |
| `pnpm score` | score every unscored `(doc, person)` pair, see [testimony](docs/testimony.md) |
| `pnpm purge <source>` | delete one source's docs for a clean re-fetch |
| `pnpm purge themes` | clear GDELT's stored theme terms, the `extra_terms` column and pre-revision `kikori:q8`-style testimony rows |
| `pnpm migrate` / `pnpm push` | create the schema on a managed Postgres, then copy a local PGlite into it |
| `pnpm export-docs` | dump every doc as one JSON line, for kikori's training set |
| `pnpm bench` / `pnpm bench:writes` | read and write baselines against their own synthetic database |
| `pnpm typecheck` / `pnpm test` | `tsc`, and `node --test` against an in-memory database |

Run `pnpm reindex` after editing `seed.json` or `src/extract.ts`. Both `pnpm typecheck` and `pnpm test` must pass before a PR.

## How it works

1. **Collect.** One collector per source in `src/collectors/*`, same signature, each storing `{ text, uri, domain, published_at, source, tone }`.
2. **Extract.** `src/extract.ts` normalizes the text and pulls hashtags, words and phrases, then tags the docs whose text names a person in `seed.json`. Terms are stored only for docs that name someone tracked.
3. **Score.** `src/graph.ts` counts terms per person and computes PMI against the docs in the window that mention any tracked person. `pnpm score` adds kikori's testimony on top, per `(doc, person)`.
4. **Serve.** `src/server.ts` is a Hono app; `public/` is the radial atlas, one page of markup plus ES modules.

Two numbers, two different questions. **Frequência** is how many documents carry the word. **PMI** is how much more often it lands near this person than chance would give, so it favours the word that is specific rather than merely common. The map's default sort multiplies PMI by `ln(1 + count)` on purpose, so a term seen twice does not outrank one seen two hundred times.

## Reading it honestly

- **Tone is GDELT-only.** `gkg` and `gdelt` docs carry a tone; every other source stores `tone = null`. Nothing invents tone for them.
- **Testimony carries a name prior.** The same hostile sentence scores around +1.9 with Lula as the target and around -4 with Bolsonaro. Read it as "this outlet against other outlets on the same person", never as "person A against person B".
- **`lean` is a judgment call with citations, not a fact.** A domain missing from `outlets.json` means nobody researched it yet — not that it is neutral.
- **A word's count means "documents where it appears at least once outside every phrase".** Phrases replace the words they cover; [terms](docs/terms.md#phrases) explains why.

## Docs

| Document | Covers |
| --- | --- |
| [API reference](docs/api.md) | every route, its parameters and its response shape |
| [Sources](docs/sources.md) | the ten collectors, their rate limits, and `seed.json` |
| [Terms, phrases and outlets](docs/terms.md) | PMI, the phrase lexicon, candidate discovery, editorial lean, tone |
| [Testimony](docs/testimony.md) | kikori, its contract, its bias, and the label-drift trap |
| [Operations](docs/operations.md) | environment, deploy, write batching, indexes, benchmarks, HTTP caching |
| [Performance baseline](docs/perf-baseline.md) | the committed output of `pnpm bench` |
| [Factory](docs/factory.md) | the spec → build → PR pipeline feature work goes through |

## Layout

```
src/collectors/*  one collector per source, same signature (Strategy)
src/extract.ts    normalization, hashtags, words, phrases, person matching
src/phrases.ts    the collocation lexicon: staging, the two floors, load
src/store.ts      doc and person inserts, shared by ingest and reindex
src/graph.ts      the scoring SQL: counts, PMI, term-term links, testimony
src/query.ts      query parsers; every parameter is snapped or clamped here
src/scorers/*     one scorer per method, same signature
src/server.ts     the Hono API and the static files
src/perf.ts       opt-in request instrumentation; src/bench*.ts the baselines
public/           design-5.html (the atlas), como-ler.html, atlas.css, js/ (format, api,
                  layout, render, state, app — imported one way, acyclic)
test/             node:test suites; fixture.ts seeds the in-memory database
seed.json         tracked people and aliases
outlets.json      researched editorial lean per domain
data/             PGlite databases, gitignored
```

`public/index.html` and `public/atlas-legacy.html`, the legacy UI pages, are gone.

## Style

Code, comments, commits, branches and PR titles in English. UI copy in pt-BR. Functional style, small pure functions, no classes. Comments only when the why is not obvious.
