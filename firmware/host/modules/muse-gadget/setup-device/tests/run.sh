#!/bin/bash
set -eu
cd "$(dirname "$0")/../../../../.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
gcc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer -Ihost/modules/muse-gadget/setup-device/tests/fakes -Ihost/modules/muse-gadget/native host/modules/muse-gadget/setup-device/tests/test.c host/modules/muse-gadget/native/setup-metadata-core.c -o "$tmp/test"
"$tmp/test"
