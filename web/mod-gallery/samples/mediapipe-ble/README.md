# MediaPipe BLE receiver package

`mod/` is the browser-visible copy of `firmware/mods/examples/mediapipe_ble/`.
The MOD Gallery test requires the executable source files to stay byte-for-byte identical.

`mediapipe-ble-v1.2.1.xsa` targets XS 17.9 and is built with Moddable SDK 10.0.2 for the CoreS3 profile. Install an SDK 10.0-compatible host before using this archive.

Version 1.2.1 replaces an archive whose `mod` entry contained Codex Voice bytecode. The versioned artifact URL avoids reusing a cached copy of that archive.

To rebuild, configure Moddable SDK 10.0.2 and ESP-IDF, then run from `firmware/`:

```sh
npm run clean
npm run mod:build -- ../web/mod-gallery/samples/mediapipe-ble/mod/manifest.json --mode=release
```

Copy `dist/bin/esp32/release/mod/mod.xsa` to the versioned artifact path above and run the Web tests. Start with a clean output directory: other Gallery manifests also live in directories named `mod`, and incremental builds can otherwise reuse another package's `mod.xsb`.
