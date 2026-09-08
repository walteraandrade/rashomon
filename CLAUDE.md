# rashomon

Which words stick to a Brazilian political figure, across Bluesky, Google News, GDELT and RSS. Node + TypeScript, Hono API, PGlite database, d3 front-ends in `public/`: the current UI is native ES modules (`public/js/*.js`) plus a stylesheet, no build step; legacy pages stay single-file.

## Commands

- `pnpm typecheck` runs `tsc`. `pnpm test` runs `node --test` against an in-memory database. Both must pass before a PR.
- `pnpm dev` serves the API and `public/` on `PORT` (default 3210). `pnpm ingest [source...]` collects. `pnpm reindex` recomputes terms and person matches from stored docs.
- `DATA_DIR` selects the PGlite directory (default `./data/pg`). `memory://` is an in-memory database and is what tests use.

## Hard constraints

- PGlite allows one process per data directory. Never run the server and an ingest/reindex on the same `DATA_DIR` at once. Agents working in parallel must each use their own `DATA_DIR`.
- Do not hit external APIs from tests. Collectors are integration code; test extraction and SQL against the fixture in `test/fixture.ts`.
- `seed.json` is the list of tracked people. Aliases match as whole words, case- and accent-insensitive. A one-word alias like "Leite" matches the beverage; prefer full names for common words. Alias words are excluded from the person's own terms. Longer aliases win: "Flávio Bolsonaro" tags Flávio only, never Jair's bare "Bolsonaro". A person's optional `exclude` list holds names that must not feed a bare alias ("Ciro Nogueira" for Ciro Gomes). Run `pnpm reindex` after editing it.
- Tone exists only on GDELT (`gkg`, `gdelt`) docs. Every other source has `tone = null`. Never invent tone for them.
- `sort=pmi` orders by `pmi * ln(1 + count)`, on purpose, so rare terms do not dominate. Do not change without a test.
- Bluesky blocks unauthenticated bursts. Keep the pacing in `src/collectors/bluesky.ts`; login via `BSKY_HANDLE` and `BSKY_APP_PASSWORD` is the sanctioned path. Never write credentials to the repo.

## Layout

- `src/collectors/*` one collector per source, same `Collector` signature.
- `src/extract.ts` normalization, hashtags, words, stopwords, person matching.
- `src/store.ts` inserts docs and persons (shared by ingest and reindex).
- `src/graph.ts` scoring SQL: counts, PMI, term-term links, sources.
- `src/server.ts` Hono routes + static files.
- `src/query.ts` query parsers for every route; each parameter is clamped there.
- `public/design-5.html` is the current UI (radial atlas), served at `/`: markup plus one `<script type="module">` that wires DOM events to `public/js/*.js`. Styles live in `public/atlas.css` (tokens, layout, components); no `<style>` block or inline `style=` in the HTML beyond a `--var` override for a genuinely dynamic value (e.g. `--size`, `--tone`). `public/index.html` is the legacy UI, reachable only by name.
- `public/js/api.js` (network), `public/js/layout.js` (pure word-packing/edge-routing geometry, no DOM), `public/js/render.js` (DOM painting; owns the browser canvas adapter that satisfies layout.js's injected `measure` function), `public/js/state.js` (mutable UI state), `public/js/format.js` (pure formatting/label helpers). Keep responsibilities distinct: layout.js and format.js never touch `document`; api.js never renders; render.js never fetches. No cycles between them (format.js → nothing; layout.js → format.js; render.js → format.js, layout.js; state.js → nothing; design-5.html's wiring script → all of the above).
- Retired single-file design alternatives (`design-1..4.html`, `design-6.html`, `graph-lab.html`, `graph-circle-lab.html`, `designs.html`) live in `docs/designs/`, outside `public/`, so the static file server never serves them. Do not extend them; they are reference only.
- Tests for the front-end import `public/js/*.js` directly (e.g. `test/layout.test.ts` imports `pack`; `test/bsky-link.test.ts` imports `bskyUrl`). Never write a test that reads `design-5.html` as text to extract or assert on JS logic.
- `test/` node:test suites. `test/fixture.ts` seeds two people and six docs; extend it rather than creating ad-hoc data.

## Style

- Code, comments, commits, branches, PR titles in English. UI copy in pt-BR.
- Functional style, small pure functions, no classes. Comments only when the why is not obvious.
- Commit messages short and imperative. Branch names `feat/ | fix/ | chore/ | refactor/ | docs/ | test/` + short kebab slug.
- Keep the API contract stable: `GET /api/people`, `GET /api/people/:id/graph`, `GET /api/people/:id/sources`. New capabilities are new routes or new optional query parameters, never breaking changes to existing fields.

## Factory

Feature work goes through the pipeline in `docs/factory.md`: `spec` workflow → human adds `spec-approved` → `build` workflow → PR → human review. Roles live in `.claude/agents/`; whoever builds never validates. Builders work in `../rashomon-<slug>` worktrees, never on the main checkout.
