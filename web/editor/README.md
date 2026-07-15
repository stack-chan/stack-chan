# Stack-chan Block Editor

Blockly-based MOD editor for Stack-chan. Everything runs client-side:

1. **Compose** — assemble Stack-chan behaviors (face, speech, motion, LED, buttons, timers) from blocks. The workspace generates a `mod.js` that exports `onContextCreated(robot)`.
2. **Build** — compile the MOD in the browser with the Moddable tools (`mcrun` → `xsc` → `xsa`) built to WebAssembly (`vendor/tools.js` + `vendor/tools.wasm`). The output is an XS archive (`mc.xsa`) containing xsb bytecode.
3. **Install** — into the [WASM simulator](../simulator/) (saved to IndexedDB, loaded at simulator launch), or onto a real device over WebSerial by flashing the archive into the device's `xs` flash partition with esptool-js. See [Installing to a real device](#installing-to-a-real-device).

## Files

| File                                       | Role                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `index.html` / `editor.mjs` / `editor.css` | Editor page, wiring, and styles                                      |
| `blocks.mjs`                               | Block definitions, JavaScript generators, toolbox, `mod.js` assembly |
| `mod-builder.mjs`                          | Client-side build pipeline driving the WASM Moddable tools           |
| `project-storage.mjs`                      | IndexedDB persistence and legacy localStorage migration              |
| `esptool-installer.mjs`                    | WebSerial device install via esptool-js (flashes the `xs` partition) |
| `vendor/tools.js`, `vendor/tools.wasm`     | Moddable SDK tools compiled with Emscripten                          |
| `vendor/esptool-js-0.5.7.bundle.mjs`       | Pinned local WebSerial flasher bundle (Apache-2.0)                   |
| `*.test.mjs`                               | Node unit tests (`npm test` in `web/`)                               |

## Rebuilding `vendor/tools.wasm`

The tools binary embeds a Moddable SDK version (currently **8.3.1**, XS 17.8) and is generated with **Emscripten 5.0.1**. Rebuild it whenever either toolchain is updated:

```sh
cd firmware
source "$HOME/.local/share/xs-dev-export.sh"
source "/path/to/emsdk-5.0.1/emsdk_env.sh"
npm run build:editor-tools
```

Notes:

- `firmware/scripts/build-editor-tools.sh` owns the Emscripten flags and copies both generated files into `web/editor/vendor/`.
- The script rejects Moddable SDK or Emscripten versions that differ from the versions above.
- CI runs the same command and fails when regeneration changes either tracked vendor file.
- `ENVIRONMENT=web,node` keeps the module loadable from both the browser and the Node test runner.
- `mod-builder.mjs` writes `/moddable/tools/VERSION` into the virtual filesystem before running `mcrun`; when the binary disagrees it detects the mismatch warning and retries with the binary's version, so a version bump usually needs no code change.

## XS version compatibility

An XS archive only loads when its XS version is compatible with the engine that runs it (`fxMapArchive` checks `XS_MOD_COMPATIBLE ≤ archive ≤ engine`). Practically:

- **Simulator** — `web/simulator/mc.wasm` must be built from the same (or newer) SDK as `vendor/tools.wasm`. Rebuild with `npm run build:wasm` in `firmware/`.
- **Device** — the flashed Stack-chan firmware must be built from the same (or newer) SDK. A version mismatch is rejected when the firmware maps the archive.

The build status line in the editor shows the XS version of the produced archive (e.g. `XS 17.8.0`).

## Simulator install requirements

The simulator needs an `mc.js` that exports `_malloc` / `_free` and `HEAPU8` so the MOD archive can be copied into WASM memory and handed to `fxMainLaunch` (see `web/simulator/bridge.mjs`). The stock Moddable wasm makefile does not export these, so `firmware/scripts/build-wasm.sh` overrides `LINK_OPTIONS` at build time. If the simulator says “this WASM build has no MOD install hook yet”, rebuild it with `npm run build:wasm`.

## Installing to a real device

The **実機に書き込み (WebSerial)** button installs the MOD entirely from the browser by
flashing the archive into the device's `xs` flash partition with
[esptool-js](https://github.com/espressif/esptool-js) — the same proven WebSerial path
the [Flash page](../flash/) uses (esp-web-tools wraps esptool-js). A MOD is exactly the
bytes of `mc.xsa` written to the `xs` partition (type `0x40`, subtype `1`); the firmware
maps and runs it on the next boot. `esptool-installer.mjs` does it:

1. Enter the ROM bootloader (esptool-js resets into it; on native USB-serial-JTAG parts
   this does not re-enumerate USB, so the WebSerial port stays valid).
2. Read the partition table from the fixed `0x8000` offset and locate the `xs` partition.
   The offset differs per board (flash size / layout), so it is **not** hardcoded.
3. Write the archive to that offset (`flashSize/Mode/Freq: keep`, no full erase).
4. Reboot into the MOD over CDC control signals — no physical RESET button. esptool-js's
   own `after('hard_reset')` only pulses RTS and can leave DTR asserted, which on a native
   USB-serial-JTAG part maps to IO0 (boot select) and reboots back into the download ROM;
   `resetToRunApp()` drives IO0 high (DTR false) while pulsing EN (RTS), both set in one
   `setSignals` call, so the chip boots the app.

Why flash the partition instead of the xsbug debug channel: it is reliable and
board-agnostic, needs no debug build and no on-device trigger, and sidesteps the fragile
xsbug handshake on native USB-serial-JTAG parts (CoreS3).

Requirements:

- A browser with WebSerial (Chrome / Edge).
- The flashed Stack-chan firmware's XS version must be **≥ the archive's** (8.3.1 / XS 17.8
  here) — see [XS version compatibility](#xs-version-compatibility). No debug build needed.
- The `-p wasm` archive runs on the ESP32 device because `fxMapArchive` gates only on the
  XS version, skips the signature, and remaps symbols by name at install time — so the
  build platform need not match the device. Verified end-to-end on an M5Stack CoreS3
  (face + balloon appear after the auto-reboot).

esptool-js 0.5.7 is checked into `vendor/` with its Apache-2.0 license and loaded locally.
Its self-contained browser bundle inlines pako and the per-chip flasher stubs.
`check:editor-artifacts` verifies the SHA-384 digest against the reviewed npm artifact.

## Tests

```sh
cd web
npm test
```

`mod-builder.test.mjs` includes a real end-to-end compile through the WASM tools (no
network needed). `esptool-installer.test.mjs` covers partition-table parsing, `xs`
partition lookup across board layouts, and the install/flash sequence with a stubbed
loader.

## Project and learning guides

- The versioned authoring format and safety contract are defined in `docs/specs/visual-programming.md`.
- The Japanese 5, 15, and 30 minute walkthrough is in `TUTORIAL_ja.md`.
- Evaluation events can be exported from the chart button in the editor header.
