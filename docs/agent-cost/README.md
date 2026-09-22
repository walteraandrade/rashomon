# Agent cost of a small UI change

The measurement issue #176 asked for: what an agent spends to make one small UI change here, on three commits, before the framework question is argued again. 27 sessions, all 27 with tests green. Total: US$ 26.60 and 140 wall-clock minutes of agent time. No code under `src/` changed; every diff was discarded after being recorded.

Files: `prompts.md` (the three prompts, verbatim; `run.sh` reads them from there), `runs.csv` (one row per session), `reads.csv` (every repo path each session read), `run.sh` (one session), `batch.sh` (all 27), `summarize.mjs` (logs → the two CSVs and the tables below). The raw `stream-json` transcripts (22 MB) stay out of the repo.

## Protocol as run

| | |
|---|---|
| commits | `dd64f03` (before `marks.ts`), `2c8f7a4` (after `marks.ts`, #171), `1e353ca` (`master` on 2026-09-22) |
| model | `claude-sonnet-5`, the model `.claude/agents/builder-ui.md` names; Claude Code 2.1.268 |
| session | `claude -p` headless, `--permission-mode acceptEdits`, Bash allowlisted to `pnpm`, `git`, `cat`, `sed`, `grep`, `rg`, `ls`, `find`, `head`, `tail`, `wc`, `node`, `npx`, `echo`, `diff`, `awk`; `--setting-sources project` (no user settings, hooks or memory); `--no-session-persistence`; 30 min timeout, never reached |
| isolation | one detached `git worktree` per session under `~/Github/rashomon-cost/`, outside the repo so no memory directory matches; `pnpm install --frozen-lockfile` before the clock starts; `DATA_DIR` per worktree |
| contention | the three commits of one (task, run) ran at the same time, so their wall times share the same machine load; batches ran one after another |
| verification | after the session, the harness stages the diff, records `git diff --shortstat` against the commit (`src/`, `test/`, `public/` separately) and re-runs `pnpm test` and `pnpm typecheck` itself. `tests_green` is that result, not the agent's claim |
| tokens and cost | the `result` event of the session: `usage` and `total_cost_usd` at list price |
| `tool_calls` | `tool_use` blocks in the transcript |
| `files_read` | distinct paths that exist at that commit, named in a `Read` input, on a Bash command line, or in a `Grep`/`grep`/`rg` result line. A path counts once per session. `CLAUDE.md` is never in this count: Claude Code injects it into the context before the first turn (see below) |
| `files_edited` | distinct paths in `Edit`/`Write` inputs |
| `lines_changed_src` | insertions plus deletions under `src/` only; `public/bundle.js` is one minified line and is reported in `notes` instead |

One session (T1 on `master`, run 1) was the pilot that validated the harness; its transcript is recorded like the other 26.

## Results

### Cost per task per commit, USD: median (min–max) of 3 runs

| task | `dd64f03` | `2c8f7a4` | `1e353ca` |
|---|---|---|---|
| T1 drawing | 0.46 (0.45–0.48) | 0.45 (0.42–0.49) | 0.73 (0.62–0.76) |
| T2 wiring | 0.96 (0.93–1.05) | 0.91 (0.89–1.06) | 1.25 (1.06–1.27) |
| T3 cross-figure | 1.05 (0.85–1.54) | 1.50 (1.11–1.74) | 1.44 (1.37–1.76) |

### Median lines changed under `src/`, and cost per line

| task | `dd64f03` lines | `2c8f7a4` lines | `1e353ca` lines | `dd64f03` $/line | `2c8f7a4` $/line | `1e353ca` $/line |
|---|---|---|---|---|---|---|
| T1 | 13 | 11 | 11 | 0.035 | 0.041 | 0.057 |
| T2 | 13 | 13 | 13 | 0.074 | 0.070 | 0.096 |
| T3 | 31 | 28 | 32 | 0.033 | 0.054 | 0.053 |

### Median tokens, tool calls, files, wall time

| task | commit | output tokens | cache-read tokens | tool calls | files read | files edited | wall s | green |
|---|---|---|---|---|---|---|---|---|
| T1 | `dd64f03` | 6 424 | 1 206 412 | 15 | 6 | 1 | 204 | 3/3 |
| T1 | `2c8f7a4` | 6 488 | 1 049 922 | 13 | 7 | 1 | 207 | 3/3 |
| T1 | `1e353ca` | 10 254 | 2 035 678 | 24 | 8 | 2 | 262 | 3/3 |
| T2 | `dd64f03` | 11 566 | 2 900 422 | 31 | 13 | 4 | 287 | 3/3 |
| T2 | `2c8f7a4` | 10 687 | 2 764 868 | 31 | 13 | 4 | 237 | 3/3 |
| T2 | `1e353ca` | 12 621 | 4 164 621 | 43 | 13 | 4 | 313 | 3/3 |
| T3 | `dd64f03` | 15 442 | 2 899 800 | 33 | 14 | 4 | 351 | 3/3 |
| T3 | `2c8f7a4` | 19 838 | 4 790 502 | 44 | 20 | 5 | 493 | 3/3 |
| T3 | `1e353ca` | 21 919 | 4 711 237 | 53 | 13 | 6 | 468 | 3/3 |

Uncached input is 28–128 tokens per session: everything is served from the prompt cache.

### Ratio wiring / drawing

| commit | T2/T1 cost | T3/T1 cost | T2/T1 $/line | T3/T1 $/line |
|---|---|---|---|---|
| `dd64f03` | 2.09 | 2.30 | 2.13 | 0.95 |
| `2c8f7a4` | 2.05 | 3.36 | 1.73 | 1.32 |
| `1e353ca` | 1.71 | 1.97 | 1.70 | 0.94 |

### The must-read set (paths read in every run of a task)

- **T1**: `src/ui/render.ts`, `src/ui/layout.ts`, `src/ui/format.ts` on every commit.
- **T2**: `src/ui/figures/compare.ts`, `src/ui/docs-card.ts`, `src/ui/figures/week.ts` (the agent copies the `openedBy` pattern from figure 5), `public/design-5.html`, `public/atlas.css`, and three test files: `test/figures-compare.test.ts`, `test/figures-week.test.ts`, `test/fake-mount-dom.ts`. On `dd64f03` and `1e353ca` also `src/ui/app.ts`.
- **T3**: `src/ui/app.ts`, `src/ui/figures/atlas.ts`, `src/ui/figures/week.ts`; on `2c8f7a4` also `CLAUDE.md`, `test/app.test.ts`, `test/figures-atlas.test.ts`, `test/figures-week.test.ts`, `test/fake-mount-dom.ts`; on `dd64f03` `test/app.test.ts`, `test/atlas-modules-acceptance.test.ts`, `test/fake-mount-dom.ts`.

Most-read paths over all 27 sessions: `public/bundle.js` and `src/ui/app.ts` 25/27 (the bundle mostly because `grep -rn` over the repo lists it, and commands name it; only one session pulled a large chunk of it into context), `src/ui/figures/week.ts` 18, `src/ui/figures/atlas.ts` 17, `test/fake-mount-dom.ts` 17, `test/figures-week.test.ts` 16, `test/figures-compare.test.ts` 15. `test/atlas-modules-acceptance.test.ts` was read in every T3 run on `dd64f03`, where it still existed; #177 dropped it before `master`.

`CLAUDE.md` is read as a tool call in 6 of 27 sessions, all T3, and **edited** in 6 of the 9 T3 sessions. Every T3 session also wired the shared person through a new place: `src/ui/state.ts` on `master` (and once on `2c8f7a4`), `src/ui/app.ts` on the two older commits. It is in every session's context regardless: the first turn inside a worktree carries 64 619 tokens against 50 037 in an empty directory, so the repo contributes about 14 600 tokens (`CLAUDE.md` is 3 820–4 028 words) to every one of the session's turns, on top of the 50 000 the harness itself brings (tool schemas and skills). Both are cache reads.

## What the numbers say

**Cost is the number of turns.** Over the 27 sessions, `cost_usd ≈ 0.10 + 0.027 × tool_calls`, correlation 0.977. The median turn re-reads 86 000 cached tokens, and about 65 000 of those are the fixed prefix that never changes with the task. Files read, lines changed and output tokens all move with the turn count; none of them explains cost on its own. A framework, or any refactor, only changes the cost if it changes how many turns the agent takes.

**The turns go to exploration and to the test loop, not to writing.** In 25 of 27 sessions the first `pnpm test` is red, and in 24 the transcript shows `bundle-freshness` as the reason: the agent tests before it builds, then builds, then tests again, two extra tool calls and a 30 s test run on every commit alike. A T1 session is 4–14 `grep`/`Read` calls, 2–5 edits and 2–5 build/test calls.

**`dd64f03 → 2c8f7a4` on T1: 0.46 → 0.45, a 2% change.** The extraction of `marks.ts` did not make the drawing change cheaper. Every T1 patch on every commit is the same edit: thread `count_recent_raw` into `RisingItem` and write it in `rulerWordMarkup`; `marks.ts` (`frame`, `axis`, `overflowList`) is never on the path.

**`master` is dearer than `2c8f7a4` on T1 (+60%) and T2 (+37%), on the same lines changed.** The T1 diff between them: on `master` the agent reads `render.ts` in full twice, reads `layout.ts` and `test/render.test.ts` in full, and generalises `paintRulerBody` over the item type; on `2c8f7a4` it greps, reads `render.ts` once and adds the field. `render.ts` is the same 1 235 lines on both. What changed between them is #177 (test suite rewritten, `render.test.ts` 1 200 → 1 281 lines, `atlas-modules-acceptance` gone) and #178 (the three word marks unified). With three runs per cell the ranges do not overlap for T1 (0.42–0.49 against 0.62–0.76), so it is not noise, but this measurement cannot say which of the two PRs, or the CLAUDE.md growth, is the cause.

**Wiring costs 1.7–2.1× drawing, cross-figure 2.0–3.4×, in absolute cost.** Per line of `src/` changed the picture is different: T2 is 1.7–2.1× (it changes 13 lines in one module plus the markup), T3 is 0.9–1.3× (it changes 28–32 lines across three modules). The cross-figure task is not expensive per line; it is expensive because there is more of it, and because 6 of 9 agents also rewrote the CLAUDE.md paragraph that describes the figure they touched, as the file asks them to.

**Three test files are in T2's must-read set and CLAUDE.md is in every session's context.** That is the case the issue named as "a cost no framework removes".

## Decision, by the rule fixed in #176

1. `dd64f03 → 2c8f7a4` cheaper on T1 by ≥ 20%: **no** (−2%). The marks extraction did not pay in agent cost. #174 (`wordMark` in `marks.ts`) is already closed; this rule gives no reason to reopen it.
2. Wiring ≥ 2× drawing per line changed: **no.** T2/T1 per line is 1.70–2.13 (one cell of three above 2), T3/T1 per line is 0.94–1.32. The spike "Preact in `src/ui/figures/*` only" is not opened.
3. Wiring < 2× drawing per line, and the must-read set carries three test files with CLAUDE.md in every turn: **the framework question is closed until the corpus of figures grows.** #175 was already merged as #177.

What this leaves on the table, none of it a framework:

- The `bundle-freshness` first failure costs every session two tool calls and a 30 s test run. A `pretest` that runs `pnpm build`, or a prompt convention, removes it for free.
- The fixed 65 000-token prefix is 75% of every turn. 14 600 of it is this repo's. A shorter `CLAUDE.md` is the one lever in the repo's hands; the other 50 000 belong to the harness configuration, not to this repo.
- `master` costing more than `2c8f7a4` on the same edits is the one open question this measurement raises. Rerunning T1 alone on `fe30c6f` (#177) and `b1fbb19` (#178), three runs each, would take 6 sessions and about US$ 3.50.

## Rerunning

```
./docs/agent-cost/batch.sh ~/Github/rashomon-cost/logs
node docs/agent-cost/summarize.mjs ~/Github/rashomon-cost/logs
```

`run.sh` skips a session whose `.meta.json` already exists, so a stopped batch resumes. `TASKS`, `RUNS`, `COMMITS` and `MODEL` narrow a rerun (`TASKS=T1 COMMITS="fe30c6f b1fbb19"`).
