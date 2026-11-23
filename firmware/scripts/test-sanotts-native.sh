#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

model_path="${SANOTTS_MODEL_PATH:-$PWD/dist/models/sanotts/sanotts-v4.bin}"
echo "a1eb6b0812e2ad2a228836088a3e34160cb66731492fb957a5891605db2fa1b6  $model_path" | sha256sum --check
mkdir -p dist/native
cc -std=c99 -O2 -g -Wall -Wextra -DSAAN_INT8_ACT=1 \
  -fsanitize=address,undefined -pthread \
  -Ivendor/sanotts-jp/csrc -Ivendor/sanotts-jp/pcm -Ivendor/sanotts-jp/moddable \
  vendor/sanotts-jp/moddable/native.test.c \
  vendor/sanotts-jp/csrc/saanotts.c vendor/sanotts-jp/csrc/saanotts_stream.c \
  vendor/sanotts-jp/csrc/saanotts_int8.c vendor/sanotts-jp/csrc/fft.c \
  vendor/sanotts-jp/csrc/g2p.c vendor/sanotts-jp/pcm/saan_pcm.c \
  -lm -o dist/native/sanotts-test
ASAN_OPTIONS=detect_leaks=1 dist/native/sanotts-test "$model_path"
cc -std=c99 -O2 -Wall -Wextra vendor/sanotts-jp/moddable/resampler.behavior.test.c -lm -o dist/native/sanotts-resampler-test
dist/native/sanotts-resampler-test