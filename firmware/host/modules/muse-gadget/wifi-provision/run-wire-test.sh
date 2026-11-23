#!/bin/sh
set -eu
cd "$(dirname "$0")/../../../.."
json=vendor/muse-gadget-sdk/pairing/managed_components/espressif__cjson/cJSON
output=$(mktemp)
trap 'rm -f "$output"' EXIT
gcc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined -I"$json" host/modules/muse-gadget/wifi-provision/wire-test.c "$json/cJSON.c" -o "$output"
"$output"
