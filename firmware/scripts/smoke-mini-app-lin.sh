#!/usr/bin/env bash
set -euo pipefail

# Keep the entry manifest in host/app so manifest.json resource paths resolve from their intended directory.
export STACKCHAN_LIN_SMOKE_MANIFEST="$PWD/host/app/manifest.mini-app-lin-smoke.json"
export STACKCHAN_LIN_SMOKE_ARCHIVE_MANIFEST="$PWD/mods/examples/mini_app_sample/manifest.json"
export STACKCHAN_LIN_SMOKE_EXPECT="[MiniApp Lin Smoke] ok"

exec bash "$PWD/scripts/smoke-lin.sh"
