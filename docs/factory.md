# The rashomon factory

A small software factory: agents do the research, spec, build, test and validation; a human approves at two gates. Everything lives in `.claude/agents/` (roles) and `.claude/workflows/` (the two pipelines).

## Roles

| Agent | May edit | Job |
|---|---|---|
| `researcher` | nothing | maps the code an issue touches; also checks the approval gate |
| `spec-writer` | nothing (posts an issue comment) | turns the issue into numbered acceptance criteria |
| `builder-api` | `src/`, `test/`, `README.md` | routes, SQL, store, with tests |
| `builder-ui` | `public/` | the interface, verified in a real browser |
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
3. **Build**. Run the `build` workflow with `{ "issue": 2, "slug": "docs-endpoint" }`. It creates `../rashomon-<slug>` on branch `feat/<slug>`, builds API then UI, writes acceptance tests, validates, fixes up to two rounds, and opens a PR. If the validator still returns it, the branch stays in the worktree for a human.
4. **Gate 2**. Review the PR. CI runs typecheck and tests. Merge or comment.

In Claude Code, ask in plain words: "run the spec workflow for issue 2", then "run the build workflow for issue 2 with slug docs-endpoint". Workflows only run when you ask. The named registry is read when a session starts; in a session where the files were just created or edited, run them by path (`.claude/workflows/spec.js`) instead of by name. The same applies to the role agents: when `.claude/agents/` is not registered yet, pass the role bodies as `args.roles` (`{ researcher: "...", "spec-writer": "..." }`) and the workflow runs them on general-purpose agents with the same instructions.

## Rules the factory relies on

- `CLAUDE.md` is the contract every agent reads first. Change the rules there, not in prompts.
- One PGlite process per directory. Builders that need the browser start their own server on a free port; if `./data/pg` is busy they verify against the running server.
- Tests never touch the network or `./data`. `pnpm test` uses `DATA_DIR=memory://` and `test/fixture.ts`.
- One issue per `build` run. Two issues in parallel would race on the same database directory.
- Visual issues (compare, split view) still pass through the pipeline, but the real gate is your eyes on the PR screenshots.

## When it is not worth it

Small fixes and one-line changes: do them in a normal session. The factory pays off on issues with a clear spec and a testable result.
