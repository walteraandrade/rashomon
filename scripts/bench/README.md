# SQL perf-verification harness

Measures every statement a route sends, plus the aggregate build, on seeded databases, and
decides whether a SQL change is kept.

## Run

```bash
node --import tsx scripts/bench/run.ts --out base.json
node --import tsx scripts/bench/run.ts --src ../rashomon-cand/src --out cand.json
node --import tsx scripts/bench/compare.ts base.json cand.json --cases graph,compare
```

`compare.ts` exits 1 unless the candidate is **kept**: every cell (every case, scale and window,
targeted or not) returns the same rows as the base, and every targeted cell's median is at least
20% lower (`--gain`).

| flag | default | meaning |
| --- | --- | --- |
| `--src` | this tree's `src/` | the tree whose `db.ts`, `graph.ts`, `aggregate.ts` are measured |
| `--scales` | `10k,100k,1m` | seeded corpus sizes |
| `--windows` | `1,7,30,90` | `days` passed to every statement |
| `--runs` | `5` | measured runs per cell, after one unmeasured warm-up |
| `--cases` | all | `aggregate` plus the names in `cases.ts` |
| `--explain <dir>` | off | writes `EXPLAIN (ANALYZE, BUFFERS)` per cell to `<dir>/<scale>/<case>.<window>d.txt` |
| `--fresh` | off | regenerates the seeds instead of reusing `data/bench-harness/seeds` |
| `--budget` | `120` | seconds of samples per cell; a slower warm-up is the only sample |
| `--timeout` | `600` | seconds one execution may run; the child is killed, the cell recorded as `> timeout` (a lower bound) and the run resumes from a fresh copy |
| `--cpu` / `BENCH_CPU` | unpinned | `taskset -c` list for the measuring child; pin both sides of a comparison to the same performance core |
| `--seeds` / `BENCH_SEEDS` | `data/bench-harness/seeds` | pristine seeds, shareable across worktrees; never opened for measurement |

## What a run does

1. Seeds each scale once (`seed.ts`, SQL-only, every value a hash of the row id) and runs `vacuum analyze`.
2. Copies the pristine seed to a scratch directory, so a candidate's migration never touches it.
3. In a fresh process per scale: sets the frozen clock, runs the tree's own `migrate`, `analyze`.
4. `aggregate`: one warm-up build plus `--runs` timed builds per window; hashes that window's rows
   of `graph_scopes`, `graph_terms` and `term_communities`. Then `vacuum analyze` on those tables.
5. Each read case per window: one warm-up, `--runs` timed executions, the hash of the ordered rows.

Output is JSON: `meta` (tree, revision, CPU, a `generate_series` calibration) and one cell per
`(scale, case, window)` with `medianMs`, `p95Ms`, `samplesMs`, `rows`, `hash`.

## Caveats

- PGlite (single-threaded WASM Postgres), not the production Supabase instance. Ratios carry over
  better than absolute milliseconds; compare runs from the same machine only.
- `now()` is frozen at `seed.ts`'s `ANCHOR` by a `bench.now()` earlier in the search path, so two
  processes, or two trees, read identical windows. `current_date` (only `/attention`) cannot be
  frozen; that route is not measured.
- Windows 1 and 90 are not route values (`query.ts`'s `DAYS` is 7/30/365); the statements accept
  any `days`, and the aggregate build is run for exactly the measured windows.
- p95 over 5 samples is the slowest sample.
- PGlite has no `statement_timeout` (WASM, no signals), so the limit is a watchdog in the parent. A
  timed-out cell has no rows: it is excluded from the equivalence check, as is `graphFast` for a window
  whose build timed out on either side; `compare.ts` lists them as unverifiable.
- The corpus is synthetic: shape (source mix, recency skew, one third of docs naming a person, a
  Zipf vocabulary growing with the corpus), not content.
