#!/usr/bin/env bash
#
# Build the WASM simulator firmware (mc.js / mc.wasm) and copy it into
# web/simulator/.
#
# The stock Moddable wasm makefile ($MODDABLE/tools/mcconfig/make.wasm.mk)
# only exports the fxMain* entry points. The browser simulator additionally
# needs `_malloc` / `_free` and the `HEAPU8` view to copy a MOD archive into
# WASM memory before passing it to fxMainLaunch (see
# web/simulator/bridge.mjs installModArchiveIntoWasm). Instead of patching
# the SDK we run the repository mcconfig wrapper in generate-only mode and
# override the makefile's LINK_OPTIONS variable from the make command line.
set -euo pipefail

FIRMWARE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${MODDABLE:-}" ]]; then
  echo "error: MODDABLE environment variable is not set" >&2
  exit 1
fi

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

FONTBM="${FONTBM:-$(command -v fontbm || true)}"
if [[ -z "$FONTBM" || ! -x "$FONTBM" ]]; then
  echo "error: fontbm is required to build simulator font resources" >&2
  exit 1
fi

MANIFEST="$FIRMWARE_DIR/host/app/manifest_wasm.json"
OUTPUT_DIR="$FIRMWARE_DIR/dist"
APP_NAME="stack-chan-host"
TMP_DIR="$OUTPUT_DIR/tmp/wasm/debug/$APP_NAME"
BIN_DIR="$OUTPUT_DIR/bin/wasm/debug/$APP_NAME"
RUNTIME_PRE_JS="$FIRMWARE_DIR/host/platforms/wasm/browser-runtime.pre.js"

LINK_OPTIONS="-s ENVIRONMENT=web \
 -s ALLOW_MEMORY_GROWTH=1 \
 -s MODULARIZE=1 \
 -s EXPORT_ES6=1 \
 -s EXPORT_NAME=mc \
 -s INVOKE_RUN=0 \
 -s FORCE_FILESYSTEM=1 \
 --pre-js $RUNTIME_PRE_JS \
 -sEXPORTED_FUNCTIONS=_fxMainIdle,_fxMainLaunch,_fxMainQuit,_fxMainTouch,_malloc,_free \
 -sEXPORTED_RUNTIME_METHODS=HEAP8,HEAPU8"

# generate the makefile and mc.xs.c without building. The wrapper owns the
# repository-local -o argument required by the build output contract.
node "$FIRMWARE_DIR/scripts/run-mcconfig.mjs" -d -p wasm -t build "$MANIFEST"

# force a relink so a LINK_OPTIONS change always takes effect
rm -f "$BIN_DIR/mc.js"

make -C "$TMP_DIR" -f makefile LINK_OPTIONS="$LINK_OPTIONS" FONTBM="$FONTBM"

mkdir -p "$FIRMWARE_DIR/../web/simulator"
cp "$BIN_DIR/mc.js" "$BIN_DIR/mc.wasm" "$FIRMWARE_DIR/../web/simulator/"
echo "copied mc.js / mc.wasm to web/simulator/"
