# Graph design exploration

Isolated worktree: `../rashomon-graph-design-lab`, branch `feat/graph-design-lab`.

This is a preserved visual study for choosing a direction, not a replacement for the current UI or an approved production feature. No existing pages, routes, scoring rules, or database files in the main checkout were modified. Production integration should follow `docs/factory.md`, including a human-approved spec and independent validation.

## Preview

Open `public/graph-lab.html` directly in a browser. It has no external dependencies. Fictional example data is clearly labeled and does not refer to any tracked person.

Or serve only the prototypes, without opening any database:

```sh
cd ../rashomon-graph-design-lab
python3 -m http.server 3218 --bind 127.0.0.1 --directory public
```

Visit `http://localhost:3218/graph-lab.html`.

To use real data, serve from this worktree's API with its own database directory, then select **Base local**:

```sh
cd ../rashomon-graph-design-lab
DATA_DIR=./data/pg PORT=3217 ./node_modules/.bin/tsx src/server.ts
```

Visit `http://localhost:3217/graph-lab.html`. A private copy of the database was made for the local browser checks. Never run another process against that directory while this server is running. The static-only preview cannot serve the API.

## Directions

| Fragment | Direction | Best for | Tradeoff |
| --- | --- | --- | --- |
| `#columns` | Ranked labels in two columns, selected term's edges in the middle | Everyday reading; retained as a secondary view after user feedback | Position is rank, not community structure |
| `#orbit` | Fixed elliptical nodes with labels outside and selected edges inside | Exploring a network without a moving force layout | Orbital distance carries no association score |
| `#matrix` | Labeled adjacency matrix with counts | Comparing cooccurrence across pairs | Requires more explanation and scrolling |

All views share the same data and filters. They support 12/18/24 terms, frequency or API-weighted PMI ordering, accent-insensitive search highlighting, click/keyboard selection, and a details panel. Live mode adds person/window selection and a five-document preview for the selected term (not a pair intersection). No tone is inferred or displayed.

Missing matrix links are labeled as not returned (fewer than two documents), not as zero. The matrix is symmetric; its diagonal is deliberately excluded. Long labels have full accessible names and native titles; their visual bounds cannot collide with counts. Narrow viewports scroll only the visualization horizontally, rather than shrinking every label. These prototypes intentionally do not port all production controls, timelines, source panels, pagination, or comparison features.

## User feedback and round-two brief

The user strongly prefers the new page design and explicitly requested that it be saved. Preserve its palette, typography hierarchy, spacing, controls, and details panel as the visual baseline. The graph proposals are not accepted as the primary visualization. Keep columns as a useful secondary reading view; the first-round HTML retains its original recommendation badge as a historical snapshot, not the current decision.

The user's reference for the next exploration is a graph contained within a circle, with the principal term emphasized in the center and associated words around it, using a different typeface and sizes determined by their score. In the current person-centered API, the central label is the tracked person's name. Re-centering the graph on an arbitrary term would require separate scope and must not imply data the API does not provide.

Suggested round-two variants, not yet implemented or approved for production:

1. **Typographic disk:** words are the nodes, inside a quiet circular boundary; no permanent edges. A central display face contrasts with horizontal, readable surrounding labels. This is the suggested lead direction.
2. **Typographic rank bands:** the same word-first approach, with stronger associations in approximate inner bands. Bands communicate rank rather than claiming exact geometric distances after collision avoidance.
3. **Focus neighborhood:** a calm word map at rest; selecting a word reveals only its returned cooccurrence links and related words, while the tracked person remains the central reference.

Use the active score consistently, disclose frequency versus weighted PMI, bound font sizes, reserve empty space around the central label, and avoid overlaps using text bounding boxes rather than just node radii. Do not invent semantic communities or tone. Prefer a settled layout to perpetual movement. New proposals should live on a new page, preserving round one for comparison. This feedback is a design direction, not the factory's `spec-approved` gate.

## Builder checks

These are implementation smoke checks, not independent validation or approval.

- Chromium via `agent-browser`, isolated session `graph-design-lab`.
- Demo and live data; live person Alexandre de Moraes returned 440 documents in the 30-day window during the check.
- All three layouts; term selection, matrix pair selection, keyboard Enter and retained SVG focus, PMI sorting, 24 terms, accent-insensitive search, five real documents, empty state, offline error and retry.
- 1440px, 900px, and 390px widths; document width did not exceed viewport width. Chart overflow stays inside its scroll region.
- No uncaught browser errors in these checks.
- Typecheck passed; all 210 existing tests passed. With shared, symlinked dependencies, pnpm 11's automatic reinstall was disabled for these commands to avoid touching another checkout:

```sh
pnpm --config.verify-deps-before-run=false typecheck
pnpm --config.verify-deps-before-run=false test
```

Screenshots: `/tmp/rashomon-shots/graph-lab/` (`01-columns.png`, `02-orbit.png`, `03-matrix.png`, `04-live-columns.png`, `05-tablet.png`, `06-mobile.png`, `07-mobile-matrix.png`, `08-empty.png`, `09-error.png`, `10-live-orbit.png`). The private API server was stopped after checks.
