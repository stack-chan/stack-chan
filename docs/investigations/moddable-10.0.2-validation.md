# Moddable SDK 10.0.2 validation

Release impact: **patch** for `stack-chan` and `stackchan-web`; a Changeset is included.

## Source and environment

The integration is based on develop `1beac0f62bbb75d5d3fcdffbb5e5829e8314127e`,
including the realtime conversation, reusable balloons, Media Player and RFID changes.
The SDK, typings, CI pins and browser compiler all use **10.0.2**. The SDK is the
unmodified official tag at `80076c48f5ab87ce29de728071b7408599071a12`.

The results below were obtained on X1, Linux x86_64, using Node 24.21.0,
TypeScript 7.0.2, ESP-IDF 6.1 and Emscripten 5.0.1. Separate source and SDK
checkouts preserve the existing development installations. Simulator runs use
Xvfb, `LIBGL_ALWAYS_SOFTWARE=1` and `GALLIUM_DRIVER=llvmpipe`.

The installed SDK's `AGENTS.md`, the HTTP, HTTP Server, WebSocket, Binary Data
and Streams Guides, `documentation/tools/manifest.md`,
`documentation/xs/mods.md`, and `examples/packages/readme.md` were consulted.
The self-review also checked the actual `mcpack` platform parser and the
application's generated manifests and link inputs. No native API or preload
changes are required.

## Manifest and package compatibility

Protocol manifests now use their SDK 10.0.2 locations under `modules/io` and
`modules/web`. Standalone MCP, audio and NTP test manifests explicitly include
the network interface. Audio streaming helpers retain their existing SDK paths.

The generated normal-host link inputs were compared with the same develop
source using SDK 10.0.1:

| Target | SDK 10.0.1 modules | SDK 10.0.2 modules | Change |
| --- | ---: | ---: | --- |
| M5StackChan CoreS3 | 403 | 400 | Remove three unused HTTP routes |
| Linux / M5Stack | 297 | 294 | Remove the same three routes |

The only removals are `serversentevents`, `static` and `ws/handshake`.
`HttpServerService` supplies its own connection handlers, and the WebSocket
clients do not use an HTTP upgrade route. TextEncoder and TextDecoder remain
explicitly included for existing MODs. Projects that use an SDK route must
include that route's manifest; the network regression does this for its test peer.

Package MOD builds resolve the selected board independently of the package's
working directory and use the package name for the archive path. SDK `mcpack`
lowercases its entire `-p` value, including custom paths. On case-sensitive
systems, a temporary lowercase alias preserves checkout paths such as
`Documents/Codex`. The alias is removed on both successful and failed commands;
a regression exercises those outcomes and a scoped package name.

`npm run test:package-mod` builds source fixtures outside `firmware/` through
the real wrapper, `mcpack` and `mcrun`. The directory-include fixture produces a
552-byte XS archive with a matching declared size. Missing imports and invalid
JavaScript return nonzero and leave no usable archive. Logs remain under
`firmware/dist/package-mod-regression/`.

## Local results

| Check | Result |
| --- | --- |
| Firmware lint / format / strict staged Biome | PASS |
| Legacy names / manifest preflight | PASS; all six configured targets |
| Architecture / board providers | 76 / 3 PASS |
| Firmware unit tests | 548 PASS |
| RFID MOD unit tests | 11 PASS |
| Package MOD success / missing package / syntax error | PASS |
| Moddable simulator manifests | 62/62 PASS |
| HTTP keep-alive and MCP wire behavior | PASS |
| Actual HTTP fetch, WebSocket text/binary and 2,048 streamed PCM samples | PASS |
| Standard M5StackChan CoreS3 release host | PASS; `10.0.2+stackchan.2` |
| Linux host startup | PASS; application ready and alive for 30 seconds |
| Browser compiler / simulator WASM rebuild | PASS |
| Web legacy / React tests | 214 / 51 PASS |
| Web typecheck and production build / editor artifact check | PASS |

Unit runs during concurrent firmware compilation exposed a timing-sensitive
existing runner shutdown test, including one serial run. After the builds
finished, an isolated runner test and the final standard `npm test` passed
(548 unit and 11 RFID cases). The test script and runner were preserved.
The full simulator suite passed independently. Expected caught-error diagnostics
in negative tests were checked against their final completion markers.

The freshly rebuilt browser compiler is byte-for-byte identical to the supplied
10.0.2 compiler artifact. The simulator is rebuilt from this integration's current
firmware. Output sizes:

| Artifact | Bytes |
| --- | ---: |
| Standard CoreS3 `xs_esp32.bin` | 6,664,640 |
| Browser compiler `tools.wasm` | 1,794,170 |
| Simulator `mc.wasm` | 5,140,424 |

## M5StackChan CoreS3 device

The identified `/dev/ttyACM0` M5StackChan CoreS3 initially ran host API 2 on
SDK 10.0.1 with a read-only RFID MOD. A local verification-only manifest locks
the driver to `none`, disables startup sound and reads back PY32 servo power OFF.
That manifest is not part of the production change.

Only the existing factory (`0x10000`) and xs (`0xfa0000`) partitions were written.
The live partition table was checked first. After writing and again after boot,
on-device hashes matched the initial bootloader, partition table, NVS, phy_init
and storage regions. No full-flash backup, secret payload retrieval, SD operation
or RFID tag write was performed.

| Device check | Result |
| --- | --- |
| Existing SDK 10.0.1-built read-only RFID MOD on the new API2 host | PASS |
| TextEncoder / TextDecoder UTF-8 round trip | PASS |
| API2 Media volume capability and RFID provider retained | PASS |
| HTTP client JSON and WebSocket text/binary against a controlled local peer | PASS |
| Streamed PCM sample count, values and endian conversion | 2,048 / 2,048 PASS |
| Native streamed PCM playback and 250ms 440Hz tone | Completion callbacks PASS |
| 100ms microphone input | Nonempty audio buffer; samples not saved |
| HTTP server UTF-8 JSON and keep-alive | Eight echoes on one connection PASS |
| HTTP 404 / handler 500 / healthy reply after error | PASS |
| Repeated software resets and app readiness | PASS |

The final device runs the SDK 10.0.2 API2 verification host with servo power OFF
and the original read-only RFID MOD restored. Repeated boot readiness and all
protected-region hashes were confirmed after restoration, and `ttyACM0` was
released. The production host build retains its normal driver configuration.

## Reproduction and remaining checks

Use a separate SDK 10.0.2 checkout, build its host tools, set `MODDABLE`, source
ESP-IDF 6.1, and put the SDK tools and `firmware/node_modules/.bin` on PATH.
Use Emscripten 5.0.1 for browser builds.

From `firmware/`, run `npm ci`, `npm run lint`, `npm run format`,
`npm run check:legacy-names`, `npm run check:manifest`,
`npm run check:architecture`, `npm run test:providers`, `npm test`,
`npm run test:package-mod`, `npm run test:moddable`, `npm run smoke:lin`,
`npm run build`, `npm run build:editor-tools` and `npm run build:wasm`.
When isolating runner timing, add `--test-concurrency=1` to the `node --test`
invocation in the existing `test:unit` file list.

From `web/`, run `npm ci`, `npm test`, `npm run build` and
`npm run check:editor-artifacts`.

Human confirmation is still needed for display appearance, touch behavior and
sound quality; completion callbacks do not establish audibility. During a repeated
diagnostic run, check the `SDK 10.0.2: HTTP / WS / PCM PASS` balloon and the brief
quiet tone. A manual full OFF/ON cycle should then confirm Wi-Fi reconnection
and the read-only RFID screen, with servo power kept OFF.

External TLS/WSS services, camera capture, physical heap/throughput/thermal
measurements and complete builds on the other ESP32 boards are not claimed.
Other boards have manifest preflight coverage. No merge or release is performed
by this validation.
