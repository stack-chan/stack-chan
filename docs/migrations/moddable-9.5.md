# Migrating to Moddable SDK 9.5

[日本語](moddable-9.5_ja.md)

## Supported toolchain and firmware

The host, browser compiler, simulator, and `@moddable/typings` use Moddable SDK 9.5.0.
ESP32 builds use ESP-IDF 6.1.
Point `MODDABLE` and `IDF_PATH` at those SDKs and source ESP-IDF’s `export.sh` before building.
Browser tools are generated with Emscripten 5.0.1.

Web Editor installation requires a 9.5.x host.
Back up settings and update the host for your board before installing MODs on devices running 8.3.x or 9.0.x.
The firmware version check rejects installation on these older hosts.

Generated archives carry XS version 17.8.2.
The default host accepts archive major/minor versions 17.7 through 17.8; the patch number does not determine compatibility.
The Web Editor and CLI share this range.
Hosts built with custom XS feature settings that change this range need their own profile.

## API changes for MOD authors

| Previous API | Replacement |
| --- | --- |
| Pass `device.network.http` or `https` to a client | `device.network.http.client` or `https.client` |
| `sntp` | `device.network.ntp.client` |
| `mdns` | `device.network.dnssd` |
| `Net.get('IP')` | The `address` property of an `ecma-wifi` instance |
| AXP2101 `readByte` / `writeByte` | `readUint8` / `writeUint8` |

NTP `getTime` callbacks return milliseconds; convert to seconds for `Time.set`.
Close the client on success, failure, disconnection, or service shutdown, and ignore replies from expired attempts.

DNS-SD advertisements follow host-name claiming, and TXT updates use `updateTXT`.
Discovery handles both newly found services and updates.
See `mimic_main` and `mimic_follow` for examples.

The host no longer directly includes classic `socket`, `sntp`, or `mdns` manifests.
SDK DNS-SD still uses classic `net` internally, so that indirect dependency remains.
The retained `WebSocket` wrapper uses ECMA-419 providers internally.
Classic BLE modules are outside this migration's scope.

## HTTP keep-alive

The HTTP service uses the ECMA-419 server directly and creates body, response, and write-offset state for each request.
This prevents a subsequent request on the same connection from reusing the previous response body.
Request URLs combine the separate `path` and `query` supplied by SDK 9.5.
MCP uses the same service while retaining its authentication and JSON-RPC handling.
Request bodies are limited to 16 KiB by default; `HttpServerService({ maxRequestBodyBytes })` can override this limit.
Requests exceeding the cumulative limit are disconnected before routing, including streamed bodies without an upfront length.

A real TCP regression test covers successive POST bodies, queries, empty responses, 404, recovery after 500, MCP authentication, and consecutive RPC requests on one connection.

## Building and generated artifacts

Run repository npm scripts from `firmware/`; output stays in that worktree's `firmware/dist/`.

```sh
npm ci
npm run build
npm run build:editor-tools
npm run build:wasm
npm run test:unit
npm run check:architecture
npm run test:moddable
```

Regenerate the browser compiler, simulator, and bundled XSA files with the same SDK.
Build bundled mini-apps from their canonical sources in `firmware/mods/examples/`; the gallery copies retain manifests with firmware-relative paths.

The original M5Stack target explicitly depends on IDF's `esp_driver_dac`.
Version metadata generation avoids replaying base SDK settings after feature manifests, which would otherwise disable BLE.

## Face rendering

Existing face parts cache and share their outlines.
This migration does not introduce `Outline.clone`; it preserves allocation and shape-sharing behavior.
Evaluate cache ownership and runtime memory separately before changing that strategy.

## Verification

Verification uses unmodified SDK 9.5.0 (`b6e06ba70506a7381ffb28e09e3175bf4e99f305`) and ESP-IDF 6.1 (`fff9895c82d744c7237be8847347bdd1b07c6643`).
Local patches from the previous SDK are not included.

The 410 Node tests, architecture checks, all 46 Moddable test manifests, Web type checking, and production build pass.
On M5StackChan CoreS3, host startup, touch-panel initialization, Wi-Fi using stored settings, and the existing MOD's WebSocket connection were observed.

Release builds pass for all six targets: M5Stack, Core2, CoreS3, M5StackChan CoreS3, Stack-chan RT, and Takao Core2 SG90.
Debug and instrumented builds also pass for CoreS3 and M5StackChan CoreS3.
The four-board distribution bundle assembles successfully with embedded version and partition-size validation.
All 208 Web Node tests, 51 React tests, visual tests, and multilingual visual tests pass.
Two independent browser compiler builds produce matching SHA-256 hashes.
The HTTP regression test also covers a large response spanning multiple writes and 100 connection/close cycles on Linux.

Compared with unmodified SDK 9.0.0 and ESP-IDF 6.0, the M5StackChan CoreS3 release image decreases from 6,425,072 to 6,379,120 bytes (45,952 bytes, about 0.7%).
Both builds start from the same repository base; the comparison includes this migration's code changes and both toolchain updates.
It does not establish runtime heap or audio performance improvements.

Sustained audio playback, repeated connection teardown, audible output, screen behavior, servo movement, and USB audio still need hardware validation.
Successful builds alone do not establish these runtime results.

## References

- [Issue #690](https://github.com/stack-chan/stack-chan/issues/690)
- [Moddable SDK 9.5.0](https://github.com/Moddable-OpenSource/moddable/releases/tag/9.5.0)
- [XS version definitions](https://github.com/Moddable-OpenSource/moddable/blob/9.5.0/xs/sources/xsCommon.h)
- [XS archive mapping](https://github.com/Moddable-OpenSource/moddable/blob/9.5.0/xs/sources/xsAPI.c)
