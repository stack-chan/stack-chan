#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${MODDABLE:-}" ]]; then
  echo "MODDABLE is not set" >&2
  exit 1
fi

export PATH="$PWD/node_modules/.bin:$PATH"

platform="${STACKCHAN_LIN_SMOKE_PLATFORM:-lin/m5stack}"
platform_path="${platform//\//\/}"
smoke_timeout="${STACKCHAN_LIN_SMOKE_TIMEOUT:-10s}"
xsbug_host="${STACKCHAN_LIN_XSBUG_HOST:-127.0.0.1}"
xsbug_port="${STACKCHAN_LIN_XSBUG_PORT:-5002}"
xsbug_log="$(mktemp "${TMPDIR:-/tmp}/stackchan-lin-xsbug-log.XXXXXX")"
server_log="$(mktemp "${TMPDIR:-/tmp}/stackchan-lin-xsbug-server.XXXXXX")"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

rm -rf "$MODDABLE/build/tmp/$platform_path/debug/stackchan" "$MODDABLE/build/bin/$platform_path/debug/stackchan"
mcconfig -dl -x "$xsbug_host:$xsbug_port" -m -p "$platform" -t build "$PWD/stackchan/manifest_local.json"

build_dir="$MODDABLE/build/tmp/$platform_path/debug/stackchan"
forbidden_imports=$(find "$build_dir" -path '*/tsc/*' -type f -name '*.js' -exec grep -nE 'runtime-bitmap-port|wasm-audio-bridge|wasm-camera-bridge' {} + || true)
if [[ -n "$forbidden_imports" ]]; then
  printf '%s\n' "$forbidden_imports"
  echo "WASM-only native binding leaked into the Linux/default import graph" >&2
  exit 1
fi

XSBUG_HOST="$xsbug_host" XSBUG_PORT="$xsbug_port" XSBUG_LOG_PATH="$xsbug_log" node ./scripts/xsbug-log-smoke-server.js >"$server_log" 2>&1 &
server_pid=$!

for _ in {1..50}; do
  if grep -q 'xsbug smoke log server listening' "$server_log" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$server_log" >&2 || true
    echo "xsbug smoke log server exited before startup" >&2
    exit 1
  fi
  sleep 0.1
done

if ! grep -q 'xsbug smoke log server listening' "$server_log" 2>/dev/null; then
  cat "$server_log" >&2 || true
  echo "xsbug smoke log server did not become ready" >&2
  exit 1
fi

set +e
timeout "$smoke_timeout" env XSBUG_HOST="$xsbug_host" XSBUG_PORT="$xsbug_port" xvfb-run -a "$MODDABLE/build/bin/lin/release/mcsim" "$MODDABLE/build/bin/$platform_path/debug/stackchan/mc.so"
status=$?
set -e

if [[ "$status" -ne 124 ]]; then
  cat "$xsbug_log" >&2 || true
  if [[ "$status" -eq 0 ]]; then
    echo "mcsim exited before $smoke_timeout; treating as startup smoke failure" >&2
    exit 1
  else
    echo "mcsim failed during startup smoke with exit code $status" >&2
    exit "$status"
  fi
fi

if grep -E 'XS abort|# exception|stack overflow|module not found|Cannot find module|unhandled exception|throw!' "$xsbug_log" >&2; then
  echo "mcsim runtime log contains startup failure markers" >&2
  echo "xsbug log: $xsbug_log" >&2
  exit 1
fi

if ! grep -q '\[main\] onRobotCreated complete' "$xsbug_log"; then
  cat "$xsbug_log" >&2 || true
  echo "mcsim startup log did not reach [main] onRobotCreated complete" >&2
  echo "xsbug log: $xsbug_log" >&2
  exit 1
fi

echo "mcsim stayed alive for $smoke_timeout; startup log reached onRobotCreated without runtime errors"
echo "xsbug log: $xsbug_log"
