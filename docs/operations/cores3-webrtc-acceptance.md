# Standard CoreS3 WebRTC acceptance

Release impact: **minor**. Standard firmware for ordinary M5Stack CoreS3 and
M5StackChan CoreS3 includes `realtimeConversation`. Host API remains 2; no
partition resize, history partition, migration, or automatic conversation is
introduced. Non-S3 targets do not include the native backend.

## Build and activation contract

Run `npm ci` in `firmware`, set up the documented Moddable/ESP-IDF environment,
then use `npm run build:m5stack_cores3` or `npm run build:m5stackchan_cores3`.
Release distribution builds use the corresponding `build:release:<board>`
scripts. The wrappers fetch the pinned Espressif WebRTC solution into this
workspace's `firmware/dist/dependencies`; `ESP_WEBRTC_SOLUTION` can select an
existing source checkout. No shared SDK source is modified. Build output and
the dependency fingerprint belong to the workspace. Keep separate output and
IDF component caches when comparing firmware or MOD variants.

The default firmware does not preload `realtimeConversation`, create its HTTPS
Worker, initialize media adapters, start native media tasks, or open I2S for an
unused conversation. The HTTPS Worker is created for the first valid request.
MP3/Opus codecs initialize their shared allocator before their own first use,
including playback before any WebRTC session.

Once created, the HTTPS Worker is reused for its caller VM's lifetime; a
conversation's `close()` releases native transport/audio, and does not terminate
that shared HTTPS Worker. A Worker-based MOD reclaims it when its owning VM is
terminated. A caller in the main VM retains the bounded Worker after first use.

`realtimeConversation` is a low-level protocol/native transport module. Its
caller must reserve the host audio capability with `robot.audio.acquireExclusive()`
before starting native audio, configure `globalThis.amp.sampleRate = 48000`, and
release that lease only after awaited conversation closure. Restore the amp to
the SDK baseline of 24000 Hz before returning to host playback. The supplied
`mods/examples/openai_live_webrtc/session.js` implements this sequence and
cleans up failed starts. In a Worker-based MOD, the main VM coordinates the host
lease and amp; do not bypass that coordination or open `AudioIn`/`AudioOut`
alongside the native duplex session. Native ownership also rejects concurrent
WebRTC transports across VMs.

Both boards use the SDK's CoreS3 ES7210 microphone and AW88298 amplifier setup.
The native duplex bus derives controller and pin definitions from the selected
board. Normal AudioOut creation reapplies its own requested amplifier rate;
an amp configuration failure closes that newly allocated AudioOut.

SDK 10.0.2's AW88298 setter caches the requested rate before its I2C write.
If that write fails, retrying the same rate on the same amplifier instance can
skip the write. AudioOut cleanup proves I2S release, not physical amplifier
recovery. The Live example attempts to restore 24000 Hz after a failed 48000 Hz
start, but that restoration can also fail. Transient amplifier-I2C failure and
same-rate retry recovery are **NOT RUN** on both boards; no SDK recovery change
is included here.

An active TTS, tone, short playback, or recording prevents exclusive acquisition.
Acquisition stops Media/WebRadio before native capture starts. While leased,
new host playback/recording is rejected. After complete native shutdown and
release, host audio may be opened again. Physical DMA/channel and codec
transitions still require the checks below.

## Memory and responsiveness

The standard S3 profile enables DTLS/SRTP and Opus, allows supported external
task allocations, places native DTLS/mbedTLS allocations in PSRAM, and reserves
internal memory for DMA and native stacks. These settings require the boards'
PSRAM. The ECMA-419 HTTPS client uses the SDK's XS TLS implementation in its
separate Worker, with that Worker's own memory configuration.
The allocation threshold/reserve affects the whole application; it does not
prove a sufficient largest contiguous internal block at runtime.

The optional Live performance manifest retains its own larger initial XS
chunk/heap, cache/flash/PSRAM-speed settings and scheduling setup. These are not
standard host defaults. Flash headroom is not runtime heap headroom. Capture
and playback staging live in PSRAM; I2S DMA and selected codec stacks require
internal RAM. Measure total free memory, minimum-ever free memory, largest
internal free block and PSRAM at idle, negotiation, duplex, close and repeated
reconnect. Include TLS errors, native task stack high-water marks and I2S
allocation failures in the evidence; do not infer these from successful links.

Transport polling processes at most 16 events per callback and schedules from
completion, allowing touch/UI callbacks to run during a native event backlog.
HTTP work uses its own Worker. Automated fairness checks cover bounded polling;
actual UI latency, audio underruns and Wi-Fi/TLS pressure need device evidence.

## Required evidence

For every run record host SHA, SDK SHA/version, ESP-IDF version, board identity,
manifest/mode, effective `sdkconfig`, generated `manifest_flat.json`, binary
size/hash and partition-table comparison. Mark each result **PASS**, **FAIL**,
**BLOCKED**, or **NOT RUN**; a compiled binary is not a hardware pass.

| Requirement | Automated evidence | Ordinary CoreS3 human/device check | M5StackChan CoreS3 human/device check |
| --- | --- | --- | --- |
| Standard distribution contains native backend | Build both release targets; inspect resolved modules/config | Boot and identify exact artifact | Boot and identify exact artifact |
| No idle conversation resources | HTTP lazy-allocation tests; resolved preload graph | Idle heap/tasks/I2S before use | Idle heap/tasks/I2S before use |
| Shared amp/I2S configuration | Target-derived C invariants; XS AudioOut failure cleanup | First MP3/TTS/recording before WebRTC | First MP3/TTS/recording before WebRTC |
| Audio exclusivity | RuntimeAudio lease and LiveSession lifecycle tests | Active recording/TTS refuses session; MP3 stops | Active recording/TTS refuses session; MP3 stops |
| Duplex and recovery | Native compile and transport cleanup tests | Connect/mute/unmute/close; MP3/TTS/record after close | Connect/mute/unmute/close; MP3/TTS/record after close |
| Failure cleanup | Failed setup, double-close, pending-connect cancellation tests | Bad TLS/network loss/low memory; retry; no stale I2S | Bad TLS/network loss/low memory; retry; no stale I2S |
| Amplifier failure recovery | XS test proves allocated AudioOut closes on setter failure | **NOT RUN**: transient I2C failure and same-rate retry on the same amp instance | **NOT RUN**: transient I2C failure and same-rate retry on the same amp instance |
| UI responsiveness | Event backlog fairness test | Touch/drawer/face during connect and duplex | Touch/drawer/face during connect and duplex |
| Runtime memory | Generated allocation config only | Internal largest block/PSRAM/stack/underruns, repeated cycles | Internal largest block/PSRAM/stack/underruns, repeated cycles |
| Compatibility | Non-S3 resolved modules, API2/version and unchanged partition tests | Existing API2 MOD load | Existing API2 MOD load |

Device resets can activate existing servo firmware. Before any reset/write,
identify the port/board, obtain safe-placement authorization, inspect the live
layout and preserve settings. An incompatible IDF filming layout must not be
replaced or erased without explicit approval. Do not flash an AI MOD as part of
this host acceptance. One connected board cannot establish both-board hardware
acceptance.

See the PR's verification record for actual results and remaining blockers.
