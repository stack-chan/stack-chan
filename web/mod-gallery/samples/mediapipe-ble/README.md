# mediapipe-ble SDK package

This package uses app API 2 and host API 7. Its canonical implementation and setup/recovery instructions are in [firmware/mediapipe_ble](../../../../firmware/mods/examples/mediapipe_ble/README_ja.md).

`source/` is generated from that example by `web/mod-gallery/canonical-sources.mjs` during the Web build. Edit the firmware example; do not maintain a second copy here. The generated manifest embeds this package's `stackchan-mod.json`.

The checked-in `mediapipe-ble.xsa` is a release archive for XS 17.8.2 / Moddable 9.5.0. Rebuild it after changing the source or package metadata. From `firmware/`:

```sh
node ../web/mod-gallery/canonical-sources.mjs
npm run mod:build -- ../web/mod-gallery/samples/mediapipe-ble/source/manifest.json --mode=release
cp dist/bin/esp32/release/source/source.xsa ../web/mod-gallery/samples/mediapipe-ble/mediapipe-ble.xsa
```

The package imports only public SDK modules and application-local helpers. Native transport, audio and UI ownership remain in the host. Archive validation does not replace physical hardware acceptance.
