# Opt-in M5StackChan CoreS3 wake-word detector

This local detector recognizes “Hi, Stack Chan” (ハイ、スタック・チャン) with
Espressif's factory model, not an arbitrary registered phrase. It does not open
a microphone, record audio, start network requests, or manage conversation
state. Standard firmware does not import it or bundle model data.

## Build

Use ESP-SR 2.4.7, [vendor source pinned to 2f8c4b0459db5bbb39abd77adae27962d6d94bcb](https://github.com/espressif/esp-sr/tree/2f8c4b0459db5bbb39abd77adae27962d6d94bcb),
registry component hash 809d0041cdddd98a278f0d5afef7bb60a451290577b98cf718dfffc91bdcbd9b.
The [M5Stack factory firmware](https://github.com/m5stack/StackChan/tree/28b9f0c8bd6acd81cb3c70f1a93c3e373b39d400/firmware)
uses this component and model. From the firmware directory, use a local,
unpacked copy from the official Espressif component registry or a previously
managed component directory:

    node scripts/package-wakeword-model.mjs /path/to/esp-sr-2.4.7
    npm run build -- m5stackchan_cores3 --mode=release --manifest host/app/manifest_m5stackchan_cores3_wakeword.json

Use a clean build workspace when switching back to standard firmware. The
packager checks the exact three model files, component manifest, vendor
license and final archive hash. It creates one 292607-byte application
resource and preserves the unmodified
[ESPRESSIF MIT license](https://components.espressif.com/components/espressif/esp-sr/versions/2.4.7/license?language=en)
in a second resource. Preserve the notice when distributing this opt-in
firmware. ESP-SR's license is for Espressif products; its model documentation
separately notes the need for relevant wake-word rights for commercial use.
Do not commit generated binaries. This option does not change the partition
table or write a filesystem.

The C binding looks up the fixed, immutable host asset directly, not a MOD
resource or a removable file. It checks the exact single-model envelope and
the ROM CRC before the vendor's lengthless loader, and owns the process-wide
registry while a detector is active. Minimize other heap pressure at startup:
the pinned vendor model loader does not check all of its metadata allocations.

## Interface and verification

The wakeword-wakenet module exports a default class. The start() method opens
a detector. detect(pcm) takes readable signed PCM16 little-endian, mono,
16 kHz, up to 8192 bytes per call. Fragments are copied synchronously into the
exact frame geometry reported by WakeNet; input storage is never retained.
The result is boolean, including when a fragment completes multiple
inference frames. chunkSamples exposes the active detector's chunk length.
reset() clears filter history and a partial chunk. close() releases the
detector and registry and is idempotent.

After packaging, this host test checks the generated envelope and frame
handling without running the target DSP archives:

    cc -std=c11 -Wall -Wextra -Werror -fsanitize=undefined \
      host/modules/wakeword-wakenet/native.test.c -o /tmp/stackchan-wakeword-test
    /tmp/stackchan-wakeword-test dist/wakeword-model/stackchan-wakenet-v247.bin

This does not establish recognition accuracy, microphone handoff, or CPU/RAM
budgets on hardware.
