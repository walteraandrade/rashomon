#!/usr/bin/env bash
# One measured session: run.sh <T1|T2|T3> <commit> <run-number> [logs-dir]
# Fresh detached worktree, deps installed before the clock starts, one headless
# claude session on the prompt from prompts.md, then the diff is measured,
# `pnpm test` re-run by us (the agent's own claim is not trusted) and the
# worktree discarded. Everything the summary needs lands in <logs-dir>.
set -uo pipefail
TASK=$1; COMMIT=$2; RUN=$3
HERE=$(cd "$(dirname "$0")" && pwd)
LOGS=${4:-$HERE/logs}
MODEL=${MODEL:-sonnet}
BASE=${COST_BASE:-$HOME/Github/rashomon-cost}
SHA=$(git -C "$HERE" rev-parse --verify "$COMMIT^{commit}")
SHORT=${SHA:0:7}
ID="$TASK-$SHORT-$RUN"
WT="$BASE/$ID"
mkdir -p "$LOGS" "$BASE"
[ -f "$LOGS/$ID.meta.json" ] && { echo "$ID already recorded"; exit 0; }

PROMPT=$(awk -v h="## $TASK" '$0==h{f=1;next} f&&/^```/{if(o){exit}o=1;next} f&&o' "$HERE/prompts.md")
[ -n "$PROMPT" ] || { echo "no prompt for $TASK" >&2; exit 2; }

git -C "$HERE" worktree remove --force "$WT" 2>/dev/null
rm -rf "$WT"
git -C "$HERE" worktree add --detach "$WT" "$SHA" >/dev/null || exit 3
( cd "$WT" && pnpm install --frozen-lockfile --offline >/dev/null 2>&1 || pnpm install --frozen-lockfile >/dev/null 2>&1 ) || { echo "install failed for $ID" >&2; exit 4; }

ALLOW='Bash(pnpm:*) Bash(git:*) Bash(cat:*) Bash(sed:*) Bash(grep:*) Bash(rg:*) Bash(ls:*) Bash(find:*) Bash(head:*) Bash(tail:*) Bash(wc:*) Bash(node:*) Bash(npx:*) Bash(echo:*) Bash(diff:*) Bash(awk:*) Bash(true:*)'
START=$(date +%s)
( cd "$WT" && DATA_DIR="$WT/data/pg" timeout 1800 claude -p "$PROMPT" \
    --model "$MODEL" \
    --output-format stream-json --verbose \
    --no-session-persistence \
    --setting-sources project \
    --permission-mode acceptEdits \
    --allowedTools $ALLOW \
    > "$LOGS/$ID.jsonl" 2> "$LOGS/$ID.stderr" )
EXIT=$?
END=$(date +%s)

cd "$WT" || exit 5
git add -A
git diff --cached --name-status "$SHA" > "$LOGS/$ID.files"
git diff --cached "$SHA" -- . ':!public/bundle.js' ':!pnpm-lock.yaml' > "$LOGS/$ID.patch"
SRC=$(git diff --cached --shortstat "$SHA" -- src | tr -d '\n')
TEST=$(git diff --cached --shortstat "$SHA" -- test | tr -d '\n')
PUBLIC=$(git diff --cached --shortstat "$SHA" -- public | tr -d '\n')
git reset -q
pnpm test > "$LOGS/$ID.test" 2>&1; TESTS=$?
pnpm typecheck > "$LOGS/$ID.typecheck" 2>&1; TYPES=$?

python3 - "$LOGS/$ID.meta.json" <<PY
import json,sys
json.dump({
  "task": "$TASK", "commit": "$SHORT", "sha": "$SHA", "run": int("$RUN"),
  "model_alias": "$MODEL", "exit_code": $EXIT,
  "wall_seconds": $((END-START)),
  "tests_green": $TESTS == 0,
  "typecheck_green": $TYPES == 0,
  "shortstat_src": "$SRC", "shortstat_test": "$TEST", "shortstat_public": "$PUBLIC",
}, open(sys.argv[1], "w"), indent=1)
PY
cd "$HERE"
git -C "$HERE" worktree remove --force "$WT"
echo "$ID exit=$EXIT wall=$((END-START))s tests=$TESTS types=$TYPES src=[$SRC] test=[$TEST]"
