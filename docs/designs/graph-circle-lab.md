# Circular word map: round two

A new design exploration in `../rashomon-graph-design-lab` on `feat/graph-design-lab`. Round one (`graph-lab.html` and its notes) is unchanged. This study follows the user's requested direction, not a production approval or the factory's `spec-approved` gate.

## Open

Static preview, fictional data, no database process:

```sh
cd ../rashomon-graph-design-lab
python3 -m http.server 3218 --bind 127.0.0.1 --directory public
```

- `http://localhost:3218/graph-circle-lab.html#disk`
- `http://localhost:3218/graph-circle-lab.html#rings`
- `http://localhost:3218/graph-circle-lab.html#focus`

The HTML also works directly from disk, without dependencies or external fonts. A secondary link opens round one's column view. The original page remains a preserved snapshot.

For live data, start the worktree's API against its private database, not the main checkout's database:

```sh
cd ../rashomon-graph-design-lab
DATA_DIR=./data/pg PORT=3217 ./node_modules/.bin/tsx src/server.ts
```

Open `http://localhost:3217/graph-circle-lab.html`, then select **Base local**. Never run two processes on this data directory. The static-only preview does not serve the API. The private API server used for builder checks was stopped afterward.

## What changed

The first study's palette, page structure, controls, and details panel remain the visual baseline. Only this new page experiments with a different main visualization:

1. **Typographic disk:** a large serif person name at the center, horizontal sans-serif words inside a quiet circular boundary, no permanent lines.
2. **Association rings:** rank-based target bands, with the same score-based type scale. Collisions take priority over radial targets; the UI explicitly describes the bands as approximate rather than exact semantic distances.
3. **Focus map:** the disk's exact same positions, with only the selected word's returned cooccurrence links visible. Non-neighbors recede. Paths route around measured label rectangles and the central name instead of crossing the text.

The central name always remains the tracked person. Selecting a word does not pretend that the existing person-centered API can re-center on an arbitrary term.

## Semantics and limits

- Font size uses either document count or `pmi * ln(1 + count)`. The bounded, nonlinear scale is relative to the current selection; it is not direct proportional encoding. Negative PMI, tied scores, and a one-term result have finite sizes.
- Font sizes range from 22 to 44 SVG units (22 to 38 for more than 18 terms). The 640px minimum map width preserves a roughly 16px minimum word size. Small screens scroll horizontally, initially centered on the person, with an explicit hint and zoom controls; the page itself does not overflow horizontally.
- Text is measured using the same font families and weights as the SVG. Packing checks whole rectangles, their corners against the circle, and a reserved central area. A few deterministic retries improve packing without changing font size per label or creating motion.
- Very long or crowded labels go into an explicitly labeled, selectable overflow list rather than disappearing, overlapping, or shrinking below the minimum. In the demo checks, all terms fit at 12/18; the 24-term weighted-PMI case needed two overflow entries. The same fallback handles unusually long names/terms.
- Disk/focus layouts are cached together. Selection, search, and zoom do not rearrange terms. Changing data, score, or density can change the composition.
- A relation is cooccurrence within documents about the person, not endorsement, causality, a semantic community, or tone. Missing links may have fewer than two documents. When not every returned link can be drawn, the map discloses the count; the full neighbor list remains available in the panel.
- Live mode preserves the existing API and adds no backend capability. It supports person/window selection and a five-document preview, including safe HTTP(S) and Bluesky links. This is not a port of every production filter, timeline, or pagination control.

## Builder checks

These are implementation smoke checks, not independent validation or visual approval.

- Chromium, isolated `agent-browser` session `graph-circle-lab`.
- All 18 combinations of 3 modes × 2 score choices × 3 term limits against the fictional example: node accounting, circle containment, center clearance, and label-rectangle separation.
- Browser SVG glyph bounds checked against measured hit areas, including live Alexandre de Moraes (18 terms) and Lula (24 weighted-PMI terms). No text collisions in those checks.
- Real data loaded from the private database; five documents opened through the existing API.
- Keyboard selection retains focus; accent-insensitive search and no-results message; zoom/reset; stable positions after selection/search.
- 1440px, 900px, and 390px layouts; no page-level horizontal overflow; the mobile map centers after a viewport resize.
- Negative and tied PMI scores, extreme long-label fallback, loading, empty response, offline error/retry, and a delayed stale response after switching back to demo.
- No uncaught browser errors in final checks.
- Typecheck passed and all 210 existing tests passed with the symlinked dependencies' automatic reinstall disabled, to avoid modifying another checkout:

```sh
pnpm --config.verify-deps-before-run=false typecheck
pnpm --config.verify-deps-before-run=false test
```

Builder artifacts (local, not versioned):

- Screenshots: `/tmp/rashomon-shots/graph-circle-lab/`
- SVG assertions: `/tmp/rashomon-circle-check.js`
- Interaction and state checks: `/tmp/rashomon-circle-interactions.js`, `/tmp/rashomon-circle-states.js`
- Combination results: `/tmp/rashomon-circle-interactions-result.json`

No production pages, `src/`, tests, or main-checkout database files were changed. Production integration still requires the factory pipeline and independent review.
