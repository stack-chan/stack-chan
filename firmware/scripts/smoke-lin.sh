#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${MODDABLE:-}" ]]; then
  echo "MODDABLE is not set" >&2
  exit 1
fi

export PATH="$PWD/node_modules/.bin:$PATH"

rm -rf "$MODDABLE/build/tmp/lin/mc/debug/stackchan" "$MODDABLE/build/bin/lin/mc/debug/stackchan"
mcconfig -d -m -p lin -t build "$PWD/stackchan/manifest_local.json"

build_dir="$MODDABLE/build/tmp/lin/mc/debug/stackchan"
forbidden_imports=$(find "$build_dir" -path '*/tsc/*' -type f -name '*.js' -exec grep -nE 'runtime-bitmap-port|wasm-audio-bridge|wasm-camera-bridge' {} + || true)
if [[ -n "$forbidden_imports" ]]; then
  printf '%s\n' "$forbidden_imports"
  echo "WASM-only native binding leaked into the Linux/default import graph" >&2
  exit 1
fi

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
