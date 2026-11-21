#!/bin/bash
set -eu
cd "$(dirname "$0")/../../../../.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
gcc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer \
  -Ihost/modules/muse-gadget/sdk-provision/tests/fakes \
  -Ihost/modules/muse-gadget/native/account-tests/fakes \
  host/modules/muse-gadget/openai-provision/tests/test.c -o "$tmp/test"
"$tmp/test"
