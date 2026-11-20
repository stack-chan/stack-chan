#!/usr/bin/env bash
set -euo pipefail

: "${MODDABLE:?MODDABLE must point to the Moddable SDK}"

case "$(uname -s)" in
  Darwin)
    host="mac"
    ;;
  *)
    host="lin"
    ;;
esac

# Moddable's tools.mk adds -d to bundled tool modules even for release builds.
# xsc then stores the real source path in each module, making tools.wasm differ
# between developer machines and GitHub runners. Release tools do not need that
# debug metadata, so remove only -d and preserve every other upstream option.
args=()
for arg in "$@"; do
  if [[ "$arg" != "-d" ]]; then
    args+=("$arg")
  fi
done

exec "$MODDABLE/build/bin/$host/release/xsc" "${args[@]}"
