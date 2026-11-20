# Web firmware installation: erase scope

Issue: [#760](https://github.com/stack-chan/stack-chan/issues/760).

## Default installation

Full-flash erase remains **off**. The host installer passes `eraseAll: false`
to the pinned `esptool-js` 0.6.0 `writeFlash()` API. This does not mean that no
flash sectors are erased: compressed writes erase the sectors covering each
image before writing it. Images are padded to a four-byte boundary by the
library; preservation must account for the entire affected flash sectors,
not only the input bytes.

The installer downloads the selected board's manifest and writes each part
at its declared offset. Current `web/flash/manifest_*.json` files contain:

| Image                             | ESP32 offset | ESP32-S3 offset |
| --------------------------------- | ------------ | --------------- |
| Bootloader                        | `0x1000`     | `0x0000`        |
| Partition table                   | `0x8000`     | `0x8000`        |
| Host application (`xs_esp32.bin`) | `0x10000`    | `0x10000`       |

The end of each range depends on the downloaded binary size. The installer
neither writes a merged whole-flash image nor explicitly writes a blank NVS or
MOD image. The three images do not include gaps between them. The release
bundle's image list is maintained in
`firmware/scripts/lib/firmware-bundle.mjs`.

For the SDK 10.0.2 partition sources used by these bundle targets, NVS starts
at `0x9000` (size `0x6000`). MOD archives live in the device's `xs` partition
(type `0x40`, subtype `1`), discovered from the partition table by the existing
MOD installer (`web/editor/esptool-installer.mjs` and
`firmware/scripts/lib/mod-flash.mjs`). Its location must not be assumed from
one board or firmware version.

Settings and MODs can be retained **only when**:

- No flashed image or its sector erase range overlaps their existing storage.
- The new partition table still exposes the retained storage at compatible
  offsets and sizes.
- The new firmware can read the stored settings and MOD archive format/API.

Keeping raw bytes does not establish compatibility. Moving partitions,
changing firmware/SDK versions, or migrating from unrelated firmware may
require a full erase and reconfiguration/reinstallation. The installer does
not read and compare the old partition table, back up data, or certify MOD
compatibility. Consequently its normal-mode explanation is conditional.

SDK partition sources:
[ESP32](https://github.com/Moddable-OpenSource/moddable/blob/10.0.2/build/devices/esp32/xsProj-esp32/partitions.csv),
[Core2](https://github.com/Moddable-OpenSource/moddable/blob/10.0.2/build/devices/esp32/targets/m5stack_core2/sdkconfig/partitions.csv),
[CoreS3](https://github.com/Moddable-OpenSource/moddable/blob/10.0.2/build/devices/esp32/targets/m5stack_cores3/sdkconfig/partitions.csv).

## Optional full erase

The checkbox starts unchecked on each form mount and is disabled during an
operation. Its value is captured for the operation and shown again in the
existing post-inspection confirmation dialog. Full erase uses an explicit
“Erase all and install” action and warns that all on-device flash data,
including saved settings and MODs, will be lost irreversibly.

After confirmation, **all images must download successfully and be nonempty**
before the writer is called. Empty manifests and negative offsets are rejected.
The adapter passes `eraseAll: true`; esptool-js sends its chip erase command
before any region writes and awaits completion. A failed erase aborts writing.
The option only applies to host installation, not MOD installation/removal.

In 0.6.0 the library silently ignores `eraseAll` unless `IS_STUB` is true.
`main()` normally starts the stub; the adapter additionally refuses full erase
without it. It never falls back to a partial write while claiming full erase.
Cancellation before confirmation never calls the writer. A failure after erase
has begun can leave the device blank or partly programmed; there is no rollback.
An external SD card is not part of the chip-flash erase.

## Automated verification and limits

- Adapter tests execute the installed esptool-js implementation with simulated
  command transport: default/opt-in command scope on ESP32 and ESP32-S3,
  four-byte padding, erase-before-write ordering, and no writes after erase failure.
- Service tests cover default/explicit modes, confirmation, cancellation,
  incompatible chips, download/empty-image failures, progress and disconnect.
- Form tests run the real hook and service with a simulated adapter in Japanese,
  English and Simplified Chinese: default off, warnings, selected-mode
  confirmation, option forwarding and cancellation.

These are host tests, not measurements of actual flash contents. Physical USB
flashing, sector-level retention/readback, post-update boot/MOD compatibility,
and full erase on M5Stack, Core2, CoreS3 and M5StackChan CoreS3 are **unverified**.
For device acceptance, save a recognizable setting and install a known MOD,
perform a compatible normal update and check retention/boot; then select full
erase and check that settings and MODs are absent after boot. Cancel a full-erase
confirmation and verify the original device data remains unchanged. Migration
from unrelated firmware needs a separate device check.
