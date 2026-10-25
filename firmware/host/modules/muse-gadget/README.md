# Experimental Muse text host

Opt-in M5StackChan CoreS3 host extension. The normal host manifest does not include
this module. It reuses **only** the Muse Gadget SDK `noise_core` at
`c9354b7a765cfb7dd3c4f1945a9ca838d871630c`; see
`firmware/vendor/muse-gadget-sdk/VENDOR_SOURCE.json` and `LICENSE`. Upstream file
headers are retained. No Muse application, board, Wi-Fi, I2S, display, OTA, tunnel,
shell or file implementation is compiled.

## Build without a device

Use Node 22+, Moddable 10.0.2 and an activated ESP-IDF 6.1 shell:

```sh
cd firmware
npm ci --ignore-scripts
npm run test:muse
npm run test:muse:native                 # Linux cc + AddressSanitizer/UBSan
STACKCHAN_MODULE_TEST_FILTER=muse-gadget npm run test:moddable
npm run build:muse                       # release, CoreS3, build only
npm run mod:build -- mods/examples/muse_text/manifest.json
```

The build wrapper prepares the local IDF component after target cleaning, as the
existing WebRTC extension does. C++17 features, `-fno-exceptions`, `-fno-rtti` and
mbedTLS/PSA are confined to the Noise component. `esp_websocket_client` 1.8.0 owns
TLS/WebSocket; the certificate bundle and hostname checks stay enabled. The host
application name and output root remain `stack-chan-host` and `firmware/dist`.
`npm run build` selects the standard host again, cleaning the changed variant.

The optional variant uses the existing `stackchan-dock` slot for Muse instead of
the Android USB conversation dock. The existing context owns its `close()`; no
new global shutdown hook or standard host feature is added. The MOD enables this
dock through `mod/config`, then adds Connect, Send greeting, and Stop buttons.
It does not connect automatically at boot. A context close, startup failure or
replacement of the active Muse runtime closes its session. Installing another
MOD through the existing MOD manager restarts the device. Hot MOD replacement
without restarting the host is not a supported loader operation.

## Credentials and connectivity still needed

This implementation has **not** connected to Muse. Mock tests verify local state
and ownership only. They do not prove TLS, server authentication, pairing, live
Noise interoperability, registration, text delivery or remote invocation.

Wi-Fi must already be configured by Stack-chan and the clock must be valid for
certificate checks. A separately authorized provisioning mechanism must supply
these NVS preferences in domain `muse`:

| Key | Meaning |
| --- | --- |
| `host` | Muse owner endpoint hostname, without scheme/path/port |
| `vmId` | VM identifier used in `/v1/noise?vm_id=...` |
| `token` | Owner **WsBearer / vm_auth_token**, sent in the TLS upgrade header |
| `nodeId` | Stable device identifier accepted by the paired owner |

An SDK pairing token (`mgst_...`) is **not** the WebSocket bearer. This extension
does not implement SDK-token onboarding, BLE/app pairing, notary/RV exchange,
account lookup, credential storage UI, refresh/revocation recovery, or acceptance
of the Gadget SDK Terms. It does not create, configure or import tokens. Obtain
approval before those actions; never put a real token in the MOD, manifest, logs,
test fixture or source control. Missing preferences fail before opening a socket.
NVS encryption at rest is outside this change and must be assessed before real
credential provisioning.

## Protocol and limits

The connection progresses through `connecting`, `noise-handshake`, `registering`,
`subscribing` and `ready`. A local Noise finish alone is not `ready`. The client
waits for the `link.register` response and `/chat/subscribe` acknowledgement.
It uses the upstream owner's empty Noise message-3 payload; authentication is in
the WSS header. It opens only these daemon routes:

* `POST /link-control` (stream 1): little-endian u32-length-prefixed JSON.
* `POST /chat/subscribe` (stream 3): bounded NDJSON, `delta.text_append` text.
* `POST /chat/stream` (odd stream IDs from 5): `{message, output_modality:"text"}`.

One unacknowledged chat request is allowed. JSON request bodies are limited to
4096 bytes including encoding overhead, control JSON to 4092 bytes, subscription
lines to less than 8192 bytes, and encrypted WebSocket messages to 8192 bytes.
Oversized server frames/lines close the session rather than being truncated.
Large replies that include full message snapshots can exceed these deliberate
first-stage limits. Full-message snapshots, history, rendering, audio, video and
chat cancellation are not implemented. The initial setup deadline is 15 seconds;
registered connections send a heartbeat every 30 seconds. There is no automatic
reconnect or credential retry: Connect explicitly creates a fresh Noise session.
There is no chat acknowledgement timeout yet; Stop/Connect recovers a stuck chat.

`commands_v2` advertises only `stackchan.smile` with no parameters. An authenticated
`link.invoke` can set `face.setEmotion(HAPPY)` once per recent request ID. Extra
parameters and other commands return a generic rejection. No input can select a
method, path, motion, audio, file or shell operation on the robot. The effect is
idempotent; the recent-ID cache is bounded to 32 entries.

## Lifetime and memory

Only the XS task touches `ClientSession`. Its envelope scratch stays stable until
all outbound frames are drained. Native inbound views are copied into an XS
ArrayBuffer before returning. WebSocket callback data is copied into a bounded
assembler and `modMessagePostToMachine` copies the posted message. At most four
events are outstanding; overflow fails the session. Each event retains a native
reference. Close marks the owner closed first, stops/joins the WebSocket task,
destroys the socket and core, wipes the adapter's bearer buffer, and lets queued
events release their references without calling JS. JS generation guards reject
events/timers from closed or replaced sessions. Close is idempotent.

No hardware heap/stack, power or runtime flash measurement has been performed.
The 2026-10-25 release build with Moddable 10.0.2 / IDF 6.1 / Xtensa GCC 15.2
produced a **6,724,976-byte** application image and a **1,858-byte** MOD archive.
DWARF compiler layout information gives **34,312 bytes** for `MuseNoise` (core
state and scratch) and **10,840 bytes** for `MuseRecord`. These are compiler/build
measurements, not observed runtime allocations or free heap. The core was
compiled with the effective final `-std=c++17`, `-fno-exceptions`, `-fno-rtti`.

Switching back through `npm run build -- --mode=release` also built successfully:
the standard image is 6,684,864 bytes, so the experimental variant adds 40,112
bytes. This compares the complete variants, including their different dock
selection, rather than measuring the SDK alone. Static `.dram0.data + .dram0.bss`
is 66,844 bytes in both builds. The standard ELF has no Muse symbols; its IDF
component list excludes both `stackchan_muse_noise` and `esp_websocket_client`.
Equal static RAM does **not** imply equal runtime RAM: the connection allocates
its native records, scratch, queue and TLS state on the heap.

Source/configuration estimates add 12 KiB of JS byte accumulators, a 6 KiB
WebSocket task stack, and up to 32 KiB of queued payload copies per connection.
TLS, socket, FreeRTOS, JSON/XS objects and allocator overhead are additional and
unmeasured. These values are not a free-heap guarantee; neither static ELF sizes
nor image sizes measure peak runtime heap or PSRAM use.

The native sanitizer tests exercise the exact assembler and reference helpers,
including copied SDK buffers, split/continuation frames, bad offsets, queue
overflow and delivery after close. JS tests use an injected transport and cover
registration gates, UTF-8 splits, late events/timers, reconnect, failures,
unsupported commands and context disposal. The simulator test exercises XS/Timer
shutdown guards. Hardware task scheduling, TLS/PSA execution on the board, actual
MOD installation/restart and live Muse behavior remain unverified.

## Upstream references

* [Muse SDK fixed revision](https://github.com/facebookincubator/muse-gadget-sdk/tree/c9354b7a765cfb7dd3c4f1945a9ca838d871630c)
* `esp32/components/noise_core/include/xplat/noise/core/ClientSession.h`
* `esp32/main/noise_control.cpp` (owner handshake, registration, link results)
* `esp32/components/muse/muse_chat_session.cpp` (subscribe and typed chat)
* [Espressif WebSocket client](https://components.espressif.com/components/espressif/esp_websocket_client/versions/1.8.0)
