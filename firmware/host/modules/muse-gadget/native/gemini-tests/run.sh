#!/bin/bash
set -eu
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cc -std=gnu11 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer -Ifakes -I../account-tests/fakes contract.c -o "$tmp/contract"
"$tmp/contract"
