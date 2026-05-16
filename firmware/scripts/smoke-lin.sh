#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${MODDABLE:-}" ]]; then
  echo "MODDABLE is not set" >&2
  exit 1
fi

export PATH="$PWD/node_modules/.bin:$PATH"

mcconfig -d -m -p lin -t build "$PWD/stackchan/manifest_local.json"

smoke_timeout="${STACKCHAN_LIN_SMOKE_TIMEOUT:-10s}"
set +e
timeout "$smoke_timeout" xvfb-run -a "$MODDABLE/build/bin/lin/release/mcsim" "$MODDABLE/build/bin/lin/mc/debug/stackchan/mc.so"
status=$?
set -e

if [[ "$status" -eq 124 ]]; then
  echo "mcsim stayed alive for $smoke_timeout; startup smoke passed"
  exit 0
fi

if [[ "$status" -eq 0 ]]; then
  echo "mcsim exited before $smoke_timeout; treating as startup smoke failure" >&2
else
  echo "mcsim failed during startup smoke with exit code $status" >&2
fi
exit "$status"
