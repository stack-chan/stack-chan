# SD files on M5StackChan CoreS3

The SDK10 ECMA-419 Files implementation owns FAT mounting, directory traversal,
and file IO. The card is mounted lazily when the MOD manager opens it, so a
missing or unreadable card does not stop firmware startup. `file.format` is 0:
mount failures never trigger formatting. The mounted root is `/sdcard`.

MODs remain read-only inputs from `mods/<name>.xsa`. Names are ASCII basenames
(letters, digits, `_`, `-`, with a lowercase `.xsa` suffix), at most 68 bytes.
Only regular files with positive sizes bounded by the `xs` partition are read.
Short reads fail. Archive layout and compiled XS version range are checked by
`mod-installer` before any flash erase/write; the existing write/readback check
and restart flow are unchanged.

## Shared LCD/SD pin

GPIO35 is LCD DC and SD MISO. `withSDCard` deactivates LCD SPI, connects MISO and
makes GPIO35 an input before any Files call, including its first lazy bootstrap.
Its `finally` restores LCD output even on mount/status/read errors. Calls are
synchronous: do not return a Promise, await, retain open handles, or access
`device.files` outside this guard. The board module keeps only this hand-off and
the archive version information from the compiled XS headers.

The standard root module mounts while being imported; XS caches a throwing
module evaluation. To preserve the MOD manager's retry after a missing-card
mount failure, this board uses the SDK's root creation/bootstrap binding in a
small deferred function, caching only successful roots. Directory and file
operations remain entirely the SDK implementation; there is no second FAT
mount or native file-IO implementation.

The slot is SPI3_HOST, CS4, MISO35, MOSI37, SCK36, 20MHz. No hot-swap guarantee
is added; the card stays mounted during this boot, as before.

## Audio and other files

The current firmware has no SD audio-save or SD audio-playback path to migrate.
Future synchronous, bounded audio saves can use the SDK API through the same
guard, without introducing a second storage implementation:

```ts
import { withSDCard } from 'stackchan-sdcard'

withSDCard((files) => {
  const file = files.openFile({ path: 'audio/recording.wav', mode: 'w' })
  try {
    file.write(wavBytes, 0)
    file.flush()
  } finally {
    file.close()
  }
})
```

The application must create `audio` beforehand, choose a safe relative path,
and bound memory/file length. The MOD manager intentionally exposes no card
write/format operation. This change adds no recording UI or asynchronous
streamer, and performs no writes to physical SD cards during validation.

## Verification

`npm run test:unit` covers invalid basenames, non-files, empty/oversized inputs,
exact-limit reads, truncated IO and handle cleanup. Run the standard POSIX Files
smoke with `STACKCHAN_MODULE_TEST_FILTER=mod-files npm run test:moddable`.
It creates and removes its own scratch directory on the simulator host; an
existing scratch directory is refused. This verifies real SDK directory/file
semantics and archive acceptance/rejection, but is not a hardware SD pass.

`npm run build:release:m5stackchan_cores3` verifies the native FAT/SDSPI link.
Hardware follow-up must use a prepared card: list/install a known MOD, reject an
oversized/corrupt archive without flash writes, check missing-card recovery and
LCD operation after each success/failure. No format, erase, flash or SD write is
authorized by these build/test commands.
