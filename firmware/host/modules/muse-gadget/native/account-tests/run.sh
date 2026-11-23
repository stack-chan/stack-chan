#!/bin/bash
set -eu
cd "$(dirname "$0")/../../../../.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
json=vendor/muse-gadget-sdk/pairing/managed_components/espressif__cjson/cJSON
gcc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer \
  -I"$json" host/modules/muse-gadget/native/account-tests/test.c \
  host/modules/muse-gadget/native/account-session-core.c "$json/cJSON.c" -o "$tmp/test"
"$tmp/test"
gcc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer \
  -Ihost/modules/muse-gadget/native/account-tests/fakes -I"$json" \
  host/modules/muse-gadget/native/account-tests/nvs-test.c \
  host/modules/muse-gadget/native/account-nvs.c \
  host/modules/muse-gadget/native/account-session-core.c "$json/cJSON.c" -o "$tmp/nvs-test"
"$tmp/nvs-test"
gcc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer \
  -Ihost/modules/muse-gadget/native/account-tests/fakes \
  host/modules/muse-gadget/native/account-tests/http-test.c \
  host/modules/muse-gadget/native/account-http.c -o "$tmp/http-test"
"$tmp/http-test"
gcc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer \
  -Ihost/modules/muse-gadget/native/account-tests/fakes -I"$json" \
  host/modules/muse-gadget/native/account-tests/worker-test.c \
  host/modules/muse-gadget/native/account-worker.c \
  host/modules/muse-gadget/native/account-session-core.c "$json/cJSON.c" -o "$tmp/worker-test"
"$tmp/worker-test"
gcc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer \
  -Ihost/modules/muse-gadget/native/account-tests/fakes \
  host/modules/muse-gadget/native/account-tests/wifi-test.c \
  host/modules/muse-gadget/native/account-wifi-driver.c -o "$tmp/wifi-test"
"$tmp/wifi-test"
gcc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer \
  -Ihost/modules/muse-gadget/native/account-tests/fakes \
  host/modules/muse-gadget/native/account-tests/sdk-test.c \
  host/modules/muse-gadget/native/sdk-token-store.c -o "$tmp/sdk-test"
"$tmp/sdk-test"
