# rashomon

Which words stick to a Brazilian political figure, across Bluesky, Google News, GDELT and RSS. Node + TypeScript, Hono API, PGlite database, native ES-module front-end in `public/` with no build step.

## Commands

- `pnpm typecheck` runs `tsc`. `pnpm test` runs `node --test` against an in-memory database. Both must pass before a PR.
- `pnpm build` bundles and minifies `public/js/app.js` and its imports into `public/bundle.js` with esbuild. Run it and commit the result whenever a module under `public/js` changes; `test/bundle-freshness.test.ts` fails if you forget.
- `pnpm dev` serves the API and `public/` on `PORT` (default 3210). `pnpm ingest [source...]` collects. `pnpm reindex` recomputes terms and person matches from stored docs.
- `DATA_DIR` selects the PGlite directory (default `./data/pg`). `memory://` is an in-memory database and is what tests use.
- `DATABASE_URL` (or `POSTGRES_URL`) switches every command to a managed Postgres over `pg`; that is how Vercel runs it (`api/index.ts`, `vercel.json`). `pnpm migrate` creates the schema there, `pnpm push` copies a local PGlite into it. Tests never set it.

## Hard constraints

- PGlite allows one process per data directory. Never run the server and an ingest/reindex on the same `DATA_DIR` at once. Agents working in parallel must each use their own `DATA_DIR`.
- Do not hit external APIs from tests. Collectors are integration code; test extraction and SQL against the fixture in `test/fixture.ts`.
- `seed.json` is the list of tracked people. Aliases match as whole words, case- and accent-insensitive. A one-word alias like "Leite" matches the beverage; prefer full names for common words. Alias words are excluded from the person's own terms. Longer aliases win: "Flávio Bolsonaro" tags Flávio only, never Jair's bare "Bolsonaro". A person's optional `exclude` list holds names that must not feed a bare alias ("Ciro Nogueira" for Ciro Gomes). Run `pnpm reindex` after editing it.
- A `phrase` term is several words as one: a capitalized run (`Alexandre de Moraes`) or a collocation the corpus shows sticking together (`primeiro turno`). The collocation lexicon lives in `phrases` and is rebuilt only by `pnpm reindex`, which therefore reads the corpus twice; `pnpm ingest` loads that lexicon and never adds to it. A phrase replaces the word occurrences it covers, positionally: a word only leaves a doc when every occurrence of it there is inside a phrase, so a word's count means "docs where it appears at least once outside every phrase". A pair touching a tracked person's alias word never enters the lexicon, or a phrase the name filter hides would delete its words with nothing in their place. A phrase carrying one of a person's own name words is dropped from that person's graph.
- `kind` on `/graph`, `/docs`, `/rising` and `/timeline` takes a comma-separated list, like `source`. `public/design-5.html` sends `word,hashtag,phrase` (`ATLAS_KINDS` in `api.js`): GDELT's theme codes stay out of the atlas but stay in the API.
- Tone exists only on GDELT (`gkg`, `gdelt`) docs. Every other source has `tone = null`. Never invent tone for them.
- `sort=pmi` orders by `pmi * ln(1 + count)`, on purpose, so rare terms do not dominate. Do not change without a test.
- Bluesky blocks unauthenticated bursts. Keep the pacing in `src/collectors/bluesky.ts`; login via `BSKY_HANDLE` and `BSKY_APP_PASSWORD` is the sanctioned path. Never write credentials to the repo.

## Layout

- `src/collectors/*` one collector per source, same `Collector` signature.
- `src/extract.ts` normalization, hashtags, words, phrases, stopwords, person matching.
- `src/phrases.ts` the collocation lexicon: staging every adjacent word pair, the count/stickiness floors, loading it back.
- `src/store.ts` inserts docs and persons (shared by ingest and reindex).
- `src/graph.ts` scoring SQL: counts, PMI, term-term links, sources.
- `src/server.ts` Hono routes + static files.
- `src/query.ts` query parsers for every route; each parameter is clamped there.
- `public/design-5.html` is the current UI, served at `/`. It is markup only: the Google Fonts link, one `<link rel="stylesheet" href="atlas.css">` and one `<script type="module" src="./bundle.js">` (the built artifact; `public/js/*.js` stays the source every test imports, and stays served, but the page no longer loads the eight modules one by one). No `<style>` block, no inline script, no inline `style=` except a `--var` override for a genuinely dynamic value. Each figure carries its own sentence inside its `.figure-head` (`.sentence-line`, five `<select>`s in `#workspace`, three in `#testimony`); the page-wide `#stats` badge is now `#atlasStats` inside `#workspace`. Below it the page is a sequence of `.figure` cards, one per graph, each with a numbered eyebrow, a title, a subtitle and its own toolbar: `#workspace` (the radial atlas, its toolbar and the `#inspector` detail column) and `#testimony` (the outlet beeswarm strip, then the recorte's own number with the per-source means as chips, then one merged outlet list in `#outletList` — `/sources`' document counts and `/testimony`'s means on the same row, laid out in as many columns as the figure is wide). There is no side column, no candidates panel and no page-wide outlet filter: clicking an outlet in `#testimony` focuses it inside that figure only (a repaint, never a fetch, and `api.js` sends no `domain`), and clicking it again or clicking empty space in the figure releases it. Documents open only in the `#docsDialog` modal, on the inspector's button: nothing on the page GETs `/docs` on its own. `public/como-ler.html` is the reading page where frequência, PMI, PMI × ln(1 + documentos), lines, tone and the kikori avaliação are explained in plain pt-BR (`#atlas`, `#avaliacao`, `#pmi` anchors). Keep it in sync with `src/graph.ts` when scoring changes.
- Every landing page (`design-5.html`, `como-ler.html`, `compare.html`) ends with one `<script defer src="/_vercel/insights/script.js"></script>` right before `</body>`: Vercel Web Analytics. It is the single exception to the "no external script" rules on those pages — the host serves it, this repo ships no code for it and never bundles it. `test/pages.ts` holds the tag and `test/analytics-acceptance.test.ts` pins it. It only resolves on a Vercel deployment; locally the path 404s.
- `public/atlas.css` holds every rule for every page: `:root` tokens (League Spartan for display, Instrument Sans for text, nothing under 11px), layout, components, the figures, the modal, the reading page and the compare page's section. `public/compare.html` and `public/como-ler.html` link it too; `compare.html` keeps only its inline script. No page gets a `<style>` block.
- `public/js/format.js` pure formatting, labels and URL helpers, plus the shared JSDoc typedefs (`Term`, `Link`, `Graph`, `Layout`, `Measure`, …) the other modules reference. `mergeOutlets` joins the two outlet payloads into the second figure's single list.
- `public/js/api.js` URL building and fetching for the documented routes (`/graph`, `/sources`, `/docs`, `/testimony`, `/candidates`). No DOM.
- `public/js/layout.js` pure geometry: `wrapLines`, `centerLabel`, `packPass`, `pack`, `routeGraph`, `routesFrom`. No DOM — text metrics arrive as an injected `measure(text, size, family, weight)`, which `render.js`'s `createCanvasMeasure()` supplies in the browser and a stub supplies in tests.
- `public/js/render.js` the DOM layer: `drawMap`, `paintSelection`, `inspect`, `paintColumns`, `wordMarkup`, `paintOutlets`, `paintTestimony`, `paintCandidates`, `paintDocs`. Paints; never fetches.
- `public/js/state.js` holds only what is page-wide and DOM-free: the scope memo (`readScope`, `writeScope`, `clearScopes`, `SCOPE_TTL_MS`, `SCOPE_LIMIT`) plus `fromScope` and `debounce`. Everything per-figure (the source filter, the focused outlet, zoom, the layout cache, the mask, request/abort bookkeeping) is private module state inside that figure's own mount().
- `public/js/figures/atlas.js` owns figure 1 end to end: its own sentence, search, pick/background, Escape, mode and mask toggles, zoom, the map/columns/inspector painters, the `#docsDialog` modal and its own `#atlasStats` badge. Exports `mount`, `createHandlers`, `layoutKey`, `docsQuery`, `scopeKeys`.
- `public/js/figures/testimony.js` owns figure 2 end to end: its own sentence, the strip, the testimony list, the outlet list, picking/releasing its own focused outlet, and its own `ResizeObserver` on `#strip`. Exports `mount`.
- `public/js/app.js` is a shell: it fetches `/api/people` once, seeds each figure from bare and prefixed querystring keys (documented in `docs/operations.md`, "Front-end bootstrapping"), and calls each figure's own `mount()`. A failed `/api/people` travels down to every figure as `peopleError`, so an outage reads as an outage and never as an empty `seed.json`. Its only export is `boot`; `boot()` runs only when a `document` exists, which is what lets tests import the wiring.
- Import direction is one way and acyclic: `format.js` ← `layout.js` ← `render.js` ← `figures/*.js` ← `app.js`, with `api.js` and `state.js` at the bottom. `test/atlas-modules-acceptance.test.ts` enforces it.
- `README.md` is the short landing page: what the project is, quick start, commands, the four honesty caveats, links. The reference lives in `docs/`: `api.md` (routes), `sources.md` (collectors and `seed.json`), `terms.md` (PMI, phrases, candidates, lean, tone), `testimony.md` (kikori), `operations.md` (env, deploy, writes, indexes, benchmarks, caching). A change documents itself in the matching page, not by growing the README back.
- `docs/designs/` holds the archived design alternatives (`design-1..4`, `design-6`, `graph-lab`, `graph-circle-lab`, `designs.html`). They are not under `public/`, so the static handler never serves them. Do not extend them.
- `public/index.html` is the legacy UI, reachable only by name; `public/atlas-legacy.html` stays a single reference file with no module surface.
- `tsconfig.json` sets `allowJs` and `checkJs`, so `pnpm typecheck` really does type-check `public/js` through its JSDoc annotations. A new module or parameter needs its types, or `tsc` fails.
- `test/` node:test suites. `test/fixture.ts` seeds two people and six docs; extend it rather than creating ad-hoc data. `test/fake-dom.ts` is a minimal `document` stand-in for asserting the markup `render.js` emits.
- Front-end behaviour is tested by importing the modules, never by grepping `design-5.html` for JavaScript. A criterion about a click or keystroke goes through `createHandlers`; a criterion about markup goes through the painter that emits it.

## Style

- Code, comments, commits, branches, PR titles in English. UI copy in pt-BR.
- Functional style, small pure functions, no classes. Comments only when the why is not obvious.
- Commit messages short and imperative. Branch names `feat/ | fix/ | chore/ | refactor/ | docs/ | test/` + short kebab slug.
- Keep the API contract stable: `GET /api/people`, `GET /api/people/:id/graph`, `GET /api/people/:id/sources`. New capabilities are new routes or new optional query parameters, never breaking changes to existing fields. `testimony=1` on `/graph` is one such parameter: off, the response is unchanged.

## Factory

Feature work goes through the pipeline in `docs/factory.md`: `spec` workflow → human adds `spec-approved` → `build` workflow → PR → human review. Roles live in `.claude/agents/`; whoever builds never validates. Builders work in `../rashomon-<slug>` worktrees, never on the main checkout.
