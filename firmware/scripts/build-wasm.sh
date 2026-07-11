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
# the SDK we run mcconfig in generate-only mode and override the makefile's
# LINK_OPTIONS variable from the make command line.
set -euo pipefail

FIRMWARE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${MODDABLE:-}" ]]; then
  echo "error: MODDABLE environment variable is not set" >&2
  exit 1
fi

MANIFEST="$FIRMWARE_DIR/host/app/manifest_wasm.json"
# mcconfig names the build output directory after the manifest's parent dir
# (host/app -> "app"), so derive it instead of hardcoding to survive a rename.
APP_NAME="$(basename "$(dirname "$MANIFEST")")"
TMP_DIR="$MODDABLE/build/tmp/wasm/debug/$APP_NAME"
BIN_DIR="$MODDABLE/build/bin/wasm/debug/$APP_NAME"

LINK_OPTIONS="-s ENVIRONMENT=web \
 -s ALLOW_MEMORY_GROWTH=1 \
 -s MODULARIZE=1 \
 -s EXPORT_ES6=1 \
 -s EXPORT_NAME=mc \
 -s INVOKE_RUN=0 \
 -s FORCE_FILESYSTEM=1 \
 -sEXPORTED_FUNCTIONS=_fxMainIdle,_fxMainLaunch,_fxMainQuit,_fxMainTouch,_malloc,_free \
 -sEXPORTED_RUNTIME_METHODS=HEAP8,HEAPU8"

# generate the makefile and mc.xs.c without building
mcconfig -d -p wasm -t build "$MANIFEST"

# force a relink so a LINK_OPTIONS change always takes effect
rm -f "$BIN_DIR/mc.js"

make -C "$TMP_DIR" -f makefile LINK_OPTIONS="$LINK_OPTIONS"

mkdir -p "$FIRMWARE_DIR/../web/simulator"
cp "$BIN_DIR/mc.js" "$BIN_DIR/mc.wasm" "$FIRMWARE_DIR/../web/simulator/"
echo "copied mc.js / mc.wasm to web/simulator/"
