#!/bin/sh
set -eu
: "${MODDABLE:?Set MODDABLE to the SDK checkout}"
export PATH="$MODDABLE/build/bin/lin/release:$PATH"
cd "$(dirname "$0")/../../../../.."
node scripts/run-mcconfig.mjs -m -p x-cli-lin -t build host/modules/muse-gadget/__tests__/voice-core-xs/manifest.json
./dist/bin/lin/release/muse-voice-core-test
