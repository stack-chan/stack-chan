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

Copy `dist/bin/esp32/release/mod/mod.xsa` to the versioned artifact path above. Start with a clean output directory: other Gallery manifests also live in directories named `mod`, and incremental builds can otherwise reuse another package's `mod.xsb`.

## Verification boundary

The behavioral requirement is that selecting this package installs the MediaPipe receiver: on a compatible host it opens the MediaPipe BLE service and consumes tracking messages, rather than registering the Codex conversation UI.

The Web tests validate catalog/manifest parsing, archive compatibility and the consistency of the published source copy with the firmware example. They do not execute the shipped `.xsa` and do not establish the behavioral requirement above. A comparison showing that MediaPipe and Codex entry bytes differ would not establish it either.

For distribution verification, rebuild from the package-declared manifest using the SDK/version and release mode above in a clean output directory. Then compare the actual packaged file with that independent build, without a fixed expected hash:

```sh
cmp dist/bin/esp32/release/mod/mod.xsa ../web/mod-gallery/samples/mediapipe-ble/mediapipe-ble-v1.2.1.xsa
```

For this correction, the previous distributed archive did not match a fresh build; version 1.2.1 matched byte-for-byte. This is source-to-artifact consistency evidence, not an automated runtime regression or a proof of build-order independence. The general same-directory-name build collision remains outside this artifact-only fix; clean rebuilding is required until build isolation is implemented.

Target-device acceptance remains pending: install only this MOD on a compatible host, restart, verify the `stackchan-mediapipe` BLE receiver is offered, then verify a tracking message changes the intended face/motion state. A host reflash or full erase is not part of this check. Servo power can remain off for the BLE discovery check; motion acceptance is a separate operator check.
