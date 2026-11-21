> For the opt-in voice backend and current verification status, see [VOICE.md](VOICE.md). The text dock below is the earlier experimental transport reused by voice.

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

## StopWatch caption font builds

The setup UI bundles the shared k8x12 Japanese font at 24 px for captions.
In the current Moddable SDK, `characterFiles` paths are resolved relative to the
top-level manifest directory, unlike font `source` paths in included manifests.
Build-variable substitution is not applied to `characterFiles` either. Keep
the offline manifest in `setup-device/` so the Japanese character subset remains
reachable. It intentionally defines its own module map: included module bindings
can win over a wrapper, silently retaining the normal main or the 16 kHz-only
output. The build wrapper invalidates those three cached modules and checks the
generated makefile bindings.

`node scripts/build-muse-native-device.mjs --cascaded-offline` builds a diagnostic
with synthetic Muse replies, a 24 kHz PCM TTS stub, and a microphone stub. It
uses the real conversation pipeline, resampler, speaker driver,
and Japanese caption font without account credentials or API calls.
`MUSE_OFFLINE pass` means three synthetic turns completed; it does not validate
real TLS, microphone capture, or a paid provider request. Restore the normal
`--setup` image after device diagnostics; preserve the device partition table
and NVS, and use the verified active app offset rather than default flash_args.

## StopWatch interaction feedback

Holding A shows a microphone and a meter driven by the existing input-level
measurements, not a second recording. A 100 ms UI timer redraws only the changed
bar; input callbacks update state without drawing. Releasing A immediately shows
`聞き取り中…` until recognition advances or fails. Empty recognition, errors, and
disconnection clear the recording display. B retains its disconnect behavior;
the saved-settings menu places Pairing and Connect to Muse in separate large
buttons inside the round display's safe region.

The UI pass preserves the existing avatar and removes competing controls rather
than importing web landing-page patterns. Relevant official guidance is
[Frontend prompt instructions](https://developers.openai.com/api/docs/guides/frontend-prompt)
and [Designing delightful frontends](https://developers.openai.com/blog/designing-delightful-frontends-with-gpt-5-4).
A distinct official document titled “frontend simplification prompt” was not
identified. Geometry/state tests do not replace an owner check of the physical
screen, touch targets, or perceived voice quality.

## StopWatch speech presets

The saved-settings menu's `Voice:` control (opened with B) cycles `marin`, `coral`, `shimmer`, and
`nova`. It defaults to `marin`; a tap saves only `ai/speechVoice`. Selecting a
voice makes no API request. The next synthesis uses the chosen preset, and the
control is absent from the conversation screen. Choose a voice after B, then
press Connect to Muse to resume. The two main menu actions keep their positions.

All four presets use `gpt-4o-mini-tts` with a natural high-pitched, bright,
friendly Japanese delivery instruction. This is a style request, not a numeric
pitch shift or a guarantee of a particular pitch. The original shared provider
default remains `tts-1`; instructions on `tts-1` / `tts-1-hd` are rejected rather
than silently ignored. Existing OpenAI credentials stay in `ai/token`.

The [speech API reference](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)
documents the instructions constraint. The [TTS guide](https://developers.openai.com/api/docs/guides/text-to-speech)
lists these voices and the PCM output format. Live requests remain billable;
profile and HTTP payload tests use fakes and do not send user audio.

## Upstream references

* [Muse SDK fixed revision](https://github.com/facebookincubator/muse-gadget-sdk/tree/c9354b7a765cfb7dd3c4f1945a9ca838d871630c)
* `esp32/components/noise_core/include/xplat/noise/core/ClientSession.h`
* `esp32/main/noise_control.cpp` (owner handshake, registration, link results)
* `esp32/components/muse/muse_chat_session.cpp` (subscribe and typed chat)
* [Espressif WebSocket client](https://components.espressif.com/components/espressif/esp_websocket_client/versions/1.8.0)

## Optional Gemini speech

OpenAI remains the default. In the B settings menu, `Speech:` explicitly toggles
OpenAI and Gemini; selection alone sends no request. Gemini selection requires
`ai/geminiToken`. Returning to OpenAI preserves `ai/token` and its selected voice.
There is no automatic fallback between providers. `Voice:` cycles the selected
provider's presets; Gemini offers Leda, Zephyr, Laomedeia, and Autonoe.

Gemini uses `gemini-3.5-transcribe` for Japanese verbatim transcription and
`gemini-3.8-flash-tts` for speech, while the LLM remains Muse. The style annotation
requests a naturally high, cheerful virtual-character delivery without imitating
a real person. Perceived cuteness and pitch require listening, not just tests.

Requests go directly to Google's HTTPS Interactions endpoint, authenticated by
`x-goog-api-key`, with `store: false`. Recorded speech is sent inline as WAV;
Muse response text and style instructions are sent for synthesis. This option
is not a claim of zero retention under every Google account policy. Free and
paid tiers have different data-use terms. Account model access, billing, and
quotas require separate verification before a live test.

Input remains bounded to 15 seconds of 16 kHz mono PCM. Gemini returns 24 kHz
mono PCM and StopWatch resamples it to 16 kHz. The
[opt-in native speech target](setup-device/NATIVE-SPEECH.md) can start playing
long replies while the final TTS request is still receiving audio. Requests have bounded parsing,
backpressure, cancellation, and deadlines. Missing credentials and unsupported
responses fail without silently switching providers. See
[Gemini transcription](https://aistudio.google.com/docs/transcribe),
[speech generation](https://aistudio.google.com/docs/speech-generation), and
[pricing](https://aistudio.google.com/docs/pricing).

The separate [Gemini provisioning tool](gemini-provision/README.md) imports an
owner-approved encrypted local credential without displaying it. Building and
mock-testing it do not provision a device or call a paid API. After provisioning,
restore the normal conversation application before use.
### Gemini service preflight

A direct service check with the approved existing Google credential completed
three requests: one nonstreaming `gemini-3.8-flash-tts` utterance, one
`gemini-3.5-transcribe` request using that generated WAV, and one streaming TTS
utterance. All returned HTTP 200 and completed status. Recognition matched the
fixed Japanese greeting. No microphone capture or speaker playback was used.

The real SSE response was replayed through the TypeScript adapter in 137-byte
transport chunks; it produced all 63,360 PCM bytes and completed normally. The
largest observed SSE JSON event was 7,809 bytes, below the 65,536-byte parser cap.
Recorded usage across the two TTS calls was 6 input text tokens and 68 output
audio tokens; STT used 36 input tokens and 2 output tokens. The estimated total
is USD 0.000711 at the tested rates, not a verified billing statement. These
checks establish service/schema compatibility, not device TLS or audible voice
quality. The device's live Gemini conversation still needs end-to-end testing.

## Gemini long-response investigation (2026-11-17)

The device report was slow speech/lip animation followed by an error. It has not
been reproduced on-device with an error code yet. A read-only COM18 observation
without DTR/RTS changes, writes, or reset found no retained failure marker.

A deterministic replay through the real Gemini provider found a separate defect:
the 45-second request deadline counted speaker backpressure. A healthy 60-second
PCM stream failed after 45 seconds; with 10 seconds of initial generation delay,
it failed after 35 seconds of playback. The TTS path now uses a 45-second idle
network deadline, paused while the consumer intentionally waits for speaker space.
A separate 180-second total safety deadline remains, along with the 120-second
PCM limit. STT and existing HTTP users keep their total request deadlines.
Cancellation and an uncooperative consumer remain bounded. The UI now logs only
an allowlisted error code, never provider text or credentials.

The pressure test also documents an unresolved limit: one valid PCM delta of
49,152 bytes produces a 65,641-byte SSE event and is rejected before playback by
the 65,536-byte event budget. Increasing the limit blindly would worsen peak
memory use. The earlier live short-text SSE fixture peaked at 7,809 bytes, so
that successful test does not establish safety for arbitrary responses.

Build inspection: PSRAM is octal 80 MHz, CPU 240 MHz; the 480,044-byte recording
uses SharedArrayBuffer/malloc and PSRAM-preferred allocation, not a guaranteed
PSRAM-only placement. I2S DMA is explicitly internal DMA-capable RAM. PCM
resampling and I2S are native, but Gemini SSE/JSON/base64 processing runs on the
main XS runtime. The SDK WebSocket realtime path instead uses a worker and native
JSONBase64Parser into a shared ring buffer. These are architectural differences,
not proof of OOM or the user's observed freeze. The mouth animation has a 250 ms
period; main-runtime scheduling delays require measurement separately.

Next device pass must capture the allowlisted error code, elapsed time, internal
heap/PSRAM minima, event high-water size, and UI timer lag together. Flash/restart
must be coordinated with the user. No new microphone or paid API call was made
for the above replay tests.

### Gemini transcription latency on StopWatch

On successful non-empty Gemini STT, the setup image traces
`MUSE_SPEECH stt_timing_<pcmBytes>_<toWritableMs>_<audioWriteMs>_<toReplyMs>_<parseMs>`.
Timing starts at STT finish, **after** the capture link drains. The first
interval includes request setup and connection to the first body pull.
The second spans lazy encoding plus local HTTP writer acceptance of the
last audio block. The third includes writing the four-byte JSON suffix,
remaining network transfer, remote processing, and waiting for the first
response body byte. It is **not** a measurement of remote inference alone.
The last interval includes reading and parsing the remaining response.
No audio, transcript, authorization, or endpoint is included.

For a deterministic transport check, run from `firmware`:
`STT_BENCH=1 node --js-base-64 --test --test-name-pattern='short synthetic STT' host/modules/voice/__tests__/gemini-speech.test.mjs`
(Node 24; on Node with native Base64 enabled by default omit the flag).
This uses only loopback HTTP, fixed generated PCM, and a fixed mock reply;
it cannot measure Wi-Fi, real model latency, or recognition accuracy. A
1.5-second fixture uses 18 instead of 65 body fragments with native Base64,
with identical WAV and content length. Fragments are not TCP packet counts.

On a physical StopWatch, an offline image alternated the previous and new STT
implementations on the same hardware, with a sink consuming the body as fast
as possible and a fixed 30 ms mock reply. Median of 3 runs per case:

| 16 kHz mono PCM | Body encode/drain before → after | STT finish to mock transcript before → after |
| --- | --- | --- |
| 48,000 bytes (1.50 s) | 4,311 → 33 ms | 4,353 → 75 ms |
| 120,160 bytes (3.76 s) | 10,805 → 75 ms | 10,847 → 118 ms |

These figures isolate post-recording work on the device. They exclude
microphone capture, Wi-Fi/TLS transfer, and actual provider recognition.
