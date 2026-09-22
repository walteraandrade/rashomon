#!/usr/bin/env bash
# All 27 sessions: for each task and run number, the three commits run at the
# same time so they share the same machine contention. batch.sh [logs-dir]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LOGS=${1:-$HERE/logs}
COMMITS=${COMMITS:-"dd64f03 2c8f7a4 master"}
for task in ${TASKS:-T1 T2 T3}; do
  for run in ${RUNS:-1 2 3}; do
    for c in $COMMITS; do
      "$HERE/run.sh" "$task" "$c" "$run" "$LOGS" &
    done
    wait
  done
done
