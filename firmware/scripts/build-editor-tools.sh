#!/usr/bin/env bash
set -euo pipefail

: "${MODDABLE:?MODDABLE must point to the Moddable SDK}"

EXPECTED_MODDABLE_VERSION="8.3.1"
ACTUAL_MODDABLE_VERSION="$(tr -d '[:space:]' < "$MODDABLE/tools/VERSION")"
if [[ "$ACTUAL_MODDABLE_VERSION" != "$EXPECTED_MODDABLE_VERSION" ]]; then
  echo "error: Moddable SDK $EXPECTED_MODDABLE_VERSION is required (found $ACTUAL_MODDABLE_VERSION)" >&2
  exit 1
fi

EXPECTED_EMSCRIPTEN_VERSION="5.0.1"
if ! command -v emcc >/dev/null 2>&1; then
  echo "error: Emscripten $EXPECTED_EMSCRIPTEN_VERSION is required (emcc was not found)" >&2
  exit 1
fi
EMCC_VERSION_LINE="$(emcc --version 2>/dev/null | sed -n '1p')"
if [[ "$EMCC_VERSION_LINE" != *" $EXPECTED_EMSCRIPTEN_VERSION "* ]]; then
  echo "error: Emscripten $EXPECTED_EMSCRIPTEN_VERSION is required (found ${EMCC_VERSION_LINE:-not installed})" >&2
  exit 1
fi

make -C "$MODDABLE/build/makefiles/wasm" -f tools.mk GOAL=release \
  LINK_FLAGS="-s ENVIRONMENT=web,node -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=tools -s INVOKE_RUN=0 -s FORCE_FILESYSTEM=1 -s ERROR_ON_UNDEFINED_SYMBOLS=0 -s EXIT_RUNTIME=0 -s \"EXPORTED_RUNTIME_METHODS=['FS','cwrap','ccall','callMain','ENV']\""

cp "$MODDABLE/build/bin/wasm/release/tools.js" "$MODDABLE/build/bin/wasm/release/tools.wasm" \
  "$PWD/../web/editor/vendor/"

echo "copied tools.js / tools.wasm to web/editor/vendor/"
