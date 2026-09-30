# The rashomon factory

A small software factory: agents do the research, spec, build, test and validation; a human approves at two gates. Everything lives in `.claude/agents/` (roles) and `.claude/workflows/` (the two pipelines).

## Roles

| Agent | May edit | Job |
|---|---|---|
| `researcher` | nothing | maps the code an issue touches; also checks the approval gate |
| `spec-writer` | nothing (posts an issue comment) | turns the issue into numbered acceptance criteria |
| `builder-api` | `src/` (including `src/ui`), `test/`, `README.md`, `CLAUDE.md`, `docs/*.md` | routes, SQL, store, and the TypeScript front end, with tests |
| `builder-ui` | `web/` and `public/` (markup, stylesheet, reading guide) | the interface, verified in a real browser |
| `test-verifier` | `test/` | tests written from the spec, not from the code |
| `validator` | nothing | judges the branch against the spec; returns gaps |
| `release` | nothing | pushes and opens the PR |

Whoever builds never judges. The validator runs on a stronger model and is told to assume the work is wrong.

## Pipeline

```
issue ──▶ spec workflow ──▶ [human: read spec, add label spec-approved] ──▶ build workflow ──▶ PR ──▶ [human: review, merge]
```

1. **Spec**. Run the `spec` workflow with `{ "issue": 2 }`. The researcher reads the code, the spec writer posts a spec as a comment on the issue.
2. **Gate 1**. Read the spec on GitHub. Edit it if needed (edit the comment). Add the label `spec-approved`.
3. **Build**. Run the `build` workflow with `{ "issue": 2, "slug": "docs-endpoint" }` (add `"base": "<branch>"` while the branch the feature depends on is not merged yet; default `master`). It creates `../rashomon-<slug>` on branch `feat/<slug>`, builds API then UI, writes acceptance tests, validates, fixes up to two rounds, merges the verifier's suite into the builder's, and opens a PR. If the validator still returns it, the branch stays in the worktree for a human.
4. **Gate 2**. Review the PR. CI runs typecheck and tests. Merge or comment.

In Claude Code, ask in plain words: "run the spec workflow for issue 2", then "run the build workflow for issue 2 with slug docs-endpoint". Workflows only run when you ask. The named registry is read when a session starts; in a session where the files were just created or edited, run them by path (`.claude/workflows/spec.js`) instead of by name. The same applies to the role agents: when `.claude/agents/` is not registered yet, pass the role bodies as `args.roles` (`{ researcher: "...", "spec-writer": "..." }`) and the workflow runs them on general-purpose agents with the same instructions.

## Rules the factory relies on

- `CLAUDE.md` is the contract every agent reads first. Change the rules there, not in prompts.
- One PGlite process per directory. Builders that need the browser start their own server on a free port; if `./data/pg` is busy they verify against the running server.
- Tests never touch the network or `./data`. `pnpm test` uses `DATA_DIR=memory://` and `test/fixture.ts`. Component specs in `test/components/` run under vitest with a DOM (happy-dom) as part of `pnpm test`, and `pnpm typecheck` covers `.svelte` files through `svelte-check`.
- One acceptance suite per criteria set reaches `master`. The verifier writes its tests without reading the builder's code, which is where its value is; before the PR opens it merges that suite into the builder's, keeping every distinct assertion. Two files asserting the same criteria break together and cover nothing extra.
- Tests live one file per `src` module or figure, never one file per issue (issue #133): `test/graph.test.ts` for `src/graph.ts`, `test/collectors-gkg.test.ts` for `src/collectors/gkg.ts`, `test/figures-atlas.test.ts` for `src/ui/figures/atlas.ts`, and so on. A new criterion is a `describe` (or an `it`) inside the module's file, labelled by the behaviour it checks; an issue number may follow as a trailing code comment when the why is not obvious, never inside the label. A new `<issue>-acceptance.test.ts` is not created. The only files that are not a module are the cross-cutting ones (`bundle-freshness`, `docs-drift`, `analytics-acceptance`, `security-headers-acceptance`, `invariants`, `leitura-ui-acceptance`, `pet-acceptance`, `batch-writes`). A suite that writes past the fixture (another person, a future-dated doc) registers `after(reseed)` from `test/fixture.ts`, since the file shares one database with the suites that pin the fixture's counts.
- One issue per `build` run. Two issues in parallel would race on the same database directory.
- Visual issues (compare, split view) still pass through the pipeline, but the real gate is your eyes on the PR screenshots.

## Jev shadow review

`.github/workflows/jev-review.yml` runs `pnpm jev-review` (`src/jev.ts`) on every pull request (`opened`, `synchronize`) and posts one comment, updated in place through a marker, with the yes/no answers of Jev (`typesafe/jev-1.13`, OpenRouter's Decisions API) to the approved spec's acceptance criteria and to six `CLAUDE.md` conventions. It is CI infrastructure, not a factory role: it only comments and never blocks a merge (the job is `continue-on-error`, never a required check, and a missing or empty `OPENROUTER_API_KEY` secret, as on a fork PR, is a logged skip rather than a failure). The raw response of every run is the artifact `jev-review.json`, kept for a later comparison against the validator's verdict and the merge outcome.

- **Input.** `state` holds exactly `diff` (`git diff origin/<base>...<head>` without `pnpm-lock.yaml`), `spec` (the most recent comment with Goal, API and Acceptance criteria sections on the issue the PR body closes with `Closes #N`) and `commits` (the PR's commit subjects). A PR with no spec gets only the convention questions, and the comment says so. When the estimate (characters divided by 4, plus the longest question) passes 32 000 tokens the comment reads `diff too large for Jev (N tokens)` and Jev is not called; nothing is ever truncated.
- **Questions.** One `ac-<n>` per criterion, then the six convention checks, each a `noul` question worded so that yes means the diff conforms: `conv-comment` (an added comment states a constraint, not history), `conv-scoring-docs` (a scoring change also touches `web/routes/como-ler/+page.svelte` or `docs/terms.md`), `conv-route-docs` (a new route or parameter also touches `docs/api.md`), `conv-class` (an added `class` is a `Data.TaggedError` or a `Context.Service`), `conv-issue-test` (no test file named after an issue) and `conv-commits` (every commit subject short, imperative, in English). Each is answerable from the diff and the commit subjects alone.
- **Output.** A table of question, answer and probability (Jev's probability of yes; 0.5 is the line), and a `Custo:` line from the response's `usage.cost`. `jev-review.json` carries `pr`, `head`, `issue`, `status` (`ok`, `too-large`, `no-key` or `api-error`), the estimated `tokens`, the questions and the raw `response`. A failed call comments `Jev indisponível (<status>)`; a comment that cannot be posted (a read-only fork token) is logged and the run still ends green.
- **Setup.** Add the repository secret `OPENROUTER_API_KEY`. Blocking on these answers is a later, separate decision, taken after about 20 pull requests of comparison.

## Jev benchmark

`pnpm bench:jev` (`scripts/jev-bench.ts`, with the pure modules `scripts/jev/questions.ts` and `scripts/jev/metrics.ts`) measures whether Jev's per-criterion answers on a branch diff would have saved validator rounds without flagging clean PRs. It is a benchmark and a dataset, not a gate: nothing in `build.js` reads it yet, and Jev never approves a branch. When a gate is built it only sends extra gaps back to the builders and the validator still runs after it.

- **`collect --pr <n>...`** builds one row per factory PR (the body has `Closes #N` and the issue has a spec comment; any other PR is skipped with a log line) and writes `bench/jev/<n>.json`. It asks Jev (`typesafe/jev-1.13`, Decisions API) and a sonnet baseline (`SONNET_BASELINE_MODEL`, `--sonnet-model` overrides it) the same questions on the same diff, through OpenRouter. `OPENROUTER_API_KEY` comes from the environment, is never written to a row, and its absence exits 1 before any request. The diff is `git diff <base>...<head>` without `pnpm-lock.yaml`; above 32 000 estimated tokens (characters divided by 4) the row gets `skipped` and no model is asked. The diff is never truncated.
- **`import <jev-review.json> --pr <n>`** merges the artifact of the [Jev shadow review](#jev-shadow-review) into the row's `jev` field (`ac-<n>` becomes `criterion:<n>`, `conv-<key>` becomes `convention:<key>`); a row that did not exist gets `source: "shadow"`.
- **`--offline [--dir bench/jev]`** reads the rows and prints the metrics table and the decision line. It makes no network call and runs no process, so it is safe anywhere; a malformed row file is named on stderr and exits 1.
- **The replay diff.** A PR opens after validation and a squash merge hides the pre-fix state, so `build.js` records for every validator round `{ round, headSha, verdict, ms, gaps: [{ criterion, severity, area }] }` and the release step puts the array in the PR body as one fenced block tagged `factory-verify`. `criterion` is the number of the acceptance criterion a gap is about (the validator omits it for a gap that spans none). The bench diffs at `rounds[0].headSha` (`diffAt: "round1"`); an older PR without the block is diffed at its final head (`diffAt: "final"`) and only counts among clean PRs when its body says it was approved at round 1. `ms` is always `null`: the workflow engine forbids `Date.now()`/`new Date()` in a script (it breaks resume), so the validator's wall time, like its cost, is unknown to the script and shown as `n/a`.
- **Labels.** A criterion is unmet for the validator when a round-1 gap names it with a severity other than `nit`. Jev's `pTrue` is the probability that the criterion is met; a criterion is flagged at threshold `t` when `1 - pTrue >= t`, for `t` in 0.70, 0.80, 0.85, 0.90 and 0.95. Convention answers are stored but never enter the metrics, and a criterion without an answer counts as not flagged.
- **Decision.** The last line is `DECISION: SHIP t=<t>`, `DECISION: HOLD t=<t> saved=<x>%`, `DECISION: HOLD (no threshold without false positives)` or `DECISION: INSUFFICIENT DATA (rows=N, returned=M)`. The rule: at least 20 PRs and at least 5 round-1 returns, or there is not enough data; then take the lowest threshold with zero clean-PR false positives (no such threshold holds the gate); ship only if at least 25% of the round-1 returns are saved, meaning Jev flags a criterion the validator marked unmet. The sonnet baseline gets its own line, labelled `baseline`, and never decides.
- **After the numbers.** Post the `--offline` output on the issue. The `build.js` gate is built in a second PR, only if it reads `SHIP`; otherwise the harness stays as the answer.

## When it is not worth it

Small fixes and one-line changes: do them in a normal session. The factory pays off on issues with a clear spec and a testable result.
