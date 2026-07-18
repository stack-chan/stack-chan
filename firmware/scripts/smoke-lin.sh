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
manifest="${STACKCHAN_LIN_SMOKE_MANIFEST:-$PWD/host/app/manifest_local.json}"
archive_manifest="${STACKCHAN_LIN_SMOKE_ARCHIVE_MANIFEST:-}"
expected_log="${STACKCHAN_LIN_SMOKE_EXPECT:-[main] app behaviors ready}"
project_name="$(basename "$(dirname "$manifest")")"
xsbug_log="$(mktemp "${TMPDIR:-/tmp}/stackchan-lin-xsbug-log.XXXXXX")"
server_log="$(mktemp "${TMPDIR:-/tmp}/stackchan-lin-xsbug-server.XXXXXX")"
config_home="$(mktemp -d "${TMPDIR:-/tmp}/stackchan-lin-mcsim-config.XXXXXX")"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ -d "$config_home" ]]; then
    rm -rf -- "$config_home"
  fi
}
trap cleanup EXIT

rm -rf "$MODDABLE/build/tmp/$platform_path/debug/$project_name" "$MODDABLE/build/bin/$platform_path/debug/$project_name"
mcconfig -dl -x "$xsbug_host:$xsbug_port" -m -p "$platform" -t build "$manifest"

build_dir="$MODDABLE/build/tmp/$platform_path/debug/$project_name"
forbidden_imports=$(find "$build_dir" -path '*/tsc/*' -type f -name '*.js' -exec grep -nE 'runtime-bitmap-port|wasm-audio-bridge|wasm-camera-bridge' {} + || true)
if [[ -n "$forbidden_imports" ]]; then
  printf '%s\n' "$forbidden_imports"
  echo "WASM-only native binding leaked into the Linux/default import graph" >&2
  exit 1
fi

mcsim_args=("$MODDABLE/build/bin/$platform_path/debug/$project_name/mc.so")
if [[ -n "$archive_manifest" ]]; then
  archive_name="$(basename "$(dirname "$archive_manifest")")"
  archive_platform="${platform%%/*}"
  mcrun -d -m -p "$platform" -t build "$archive_manifest"
  archive_path="$MODDABLE/build/bin/$archive_platform/mc/debug/$archive_name/mc.xsa"
  if [[ ! -f "$archive_path" ]]; then
    echo "mcrun did not produce the expected archive: $archive_path" >&2
    exit 1
  fi
  mcsim_args+=("$archive_path")
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
simulator_command=(xvfb-run -a "$MODDABLE/build/bin/lin/release/mcsim" "${mcsim_args[@]}")
if command -v dbus-run-session >/dev/null 2>&1; then
  simulator_command=(dbus-run-session -- "${simulator_command[@]}")
fi
timeout "$smoke_timeout" env \
  XSBUG_HOST="$xsbug_host" \
  XSBUG_PORT="$xsbug_port" \
  XDG_CONFIG_HOME="$config_home" \
  NO_AT_BRIDGE=1 \
  GTK_A11Y=none \
  GIO_USE_VFS=local \
  "${simulator_command[@]}"
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

if grep -E 'XS abort|# exception|stack overflow|module not found|Cannot find module|unhandled exception|throw!|\[main\] error' "$xsbug_log" >&2; then
  echo "mcsim runtime log contains startup failure markers" >&2
  echo "xsbug log: $xsbug_log" >&2
  exit 1
fi

if ! grep -Fq "$expected_log" "$xsbug_log"; then
  cat "$xsbug_log" >&2 || true
  echo "mcsim runtime log did not reach expected marker: $expected_log" >&2
  echo "xsbug log: $xsbug_log" >&2
  exit 1
fi

echo "mcsim stayed alive for $smoke_timeout; runtime log reached '$expected_log' without errors"
echo "xsbug log: $xsbug_log"
