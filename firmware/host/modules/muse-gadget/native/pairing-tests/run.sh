#!/bin/bash
set -eu
: "${MODDABLE:?Set MODDABLE to the SDK checkout}"
: "${IDF_PATH:?Set IDF_PATH to the ESP-IDF checkout}"
cd "$(dirname "$0")/../../../../.."
root=vendor/muse-gadget-sdk/pairing
crypto="$IDF_PATH/components/mbedtls/mbedtls/tf-psa-crypto"
output=$(mktemp -d)
trap 'rm -rf "$output"' EXIT
gcc -std=c11 -ffunction-sections -fdata-sections -Wl,--gc-sections \
  -I"$MODDABLE/xs/includes" -I"$MODDABLE/xs/platforms" -I"$MODDABLE/build/tmp/lin/release/tools" \
  -I"$root/main" -I"$root/managed_components/espressif__cjson/cJSON" \
  -I"$crypto/include" -I"$crypto/drivers/builtin/include" \
  -Ihost/modules/muse-gadget/native/account-tests/fakes \
  host/modules/muse-gadget/native/pairing-tests/validation.c \
  host/modules/muse-gadget/native/account-session-core.c \
  host/modules/muse-gadget/native/account-worker.c \
  "$root/managed_components/espressif__cjson/cJSON/cJSON.c" -lm -o "$output/validation"
"$output/validation"
cd "$root"
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_link_pairing_*.py'
