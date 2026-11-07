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
existing source checkout. No shared SDK source is modified. Build output belongs to the workspace. Each target uses one build configuration;
configuration changes do not trigger an automatic clean. Run `npm run clean`
explicitly or use a separate worktree when changing that configuration.

The default firmware does not preload `realtimeConversation`, create its HTTPS
Worker, initialize media adapters, start native media tasks, or open I2S for an
unused conversation. The HTTPS Worker is created for the first valid request.
MP3/Opus codecs initialize their shared allocator before their own first use,
including playback before any WebRTC session.

The HTTPS Worker is reclaimed after both the caller's pending requests and the
Worker's queue have drained, and is recreated for the next request. A caller
timeout alone cannot reclaim it: TLS/socket cleanup or a queued hangup can still
be running. The idle acknowledgement is sent after the queue's exception frames
have unwound. If both acknowledgement delivery and retry-timer allocation fail,
the idle Worker can remain until a later request or caller VM termination.
A conversation's awaited `close()` releases its native transport/audio; an
asynchronous hangup can keep the HTTP Worker alive beyond that point.

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

`CONFIG_SPIRAM_MALLOC_RESERVE_INTERNAL=98304` is a boot-time heap policy, not a
96 KiB WebRTC buffer that can be allocated or freed by a MOD. In ESP-IDF 6.1,
the reserved DMA/internal pool also retains low-priority `MALLOC_CAP_DEFAULT`
fallback. A MOD cannot change this compiled policy or the linked code/data.
Do not reduce the reserve merely to increase a reported free-heap value.

| Phase | WebRTC-owned allocation and release |
| --- | --- |
| Standard host / unrelated MOD | Linked code, native static data and module metadata remain. No conversation Worker, transport queues, media tasks or I2S are opened. |
| Import / construct conversation | JS module/object state only; no native transport or HTTP Worker. |
| Explicit `connect()` | Native queues and peer task, then capture/render, codecs, I2S DMA, media buffers and ICE/DTLS resources as negotiation proceeds. HTTPS creates its Worker on the first valid request. |
| Awaited `close()` | Native transport/audio tasks, queues, peer and per-session media resources are released before the audio lease is returned. HTTP drains independently as described above. |
| After first use | Shared media adapters, default codec registrations and scheduler setup remain initialized. They also serve ordinary audio; unregistering them on conversation close would violate shared ownership. |

Keep the existing USB bridge/EVENT runtime lifetime unchanged: its driver has
needed early allocation to avoid fragmented internal RAM. WebRTC-specific
late allocation must be checked separately with largest-block and reconnect
measurements; this change does not establish that allocation can always succeed.

Compare a no-WebRTC host and the standard host using the same SDK/IDF revisions,
board, release mode, standard XS creation settings, Wi-Fi and non-WebRTC MOD.
Record ELF/map flash and RAM sections separately from runtime heap. Then record
internal/PSRAM free, minimum and largest blocks, tasks and Worker counts at boot,
import, construction, connect, awaited close plus HTTP drain, and repeated
reconnect. Do not add overlapping all-8-bit and internal/PSRAM heap totals. No
runtime memory savings are claimed from build sizes alone.

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
layout and preserve settings. An incompatible IDF flashing layout must not be
replaced or erased without explicit approval. Do not flash an AI MOD as part of
this host acceptance. One connected board cannot establish both-board hardware
acceptance.

## v2.1.0 candidate status (2026-11-07)

The release scope is current `develop` (`906ee9a0cd2a0107a24c714efb10274f3b546afa`)
plus the runtime-coexistence prerequisite #772 (`7a0733da37441c4e7f9980548937cb3e824b3e8c`)
and standard-host inclusion #757 (`966877ed2024868d2605bb9a5f80eea0354d2d5c`).
The release branch preserves this ancestry. At preparation time neither PR is
merged; their integration/review and the release PR's own CI remain pending.

Both prerequisite heads passed Build and Bundle CI, including six release build
targets, XS tests, simulator smoke and web checks:
[#772 Build](https://github.com/stack-chan/stack-chan/actions/runs/42333975928),
[#772 Bundle](https://github.com/stack-chan/stack-chan/actions/runs/42333975840),
[#757 Build](https://github.com/stack-chan/stack-chan/actions/runs/42333948376),
[#757 Bundle](https://github.com/stack-chan/stack-chan/actions/runs/42333945012).
These are build/test passes for those source heads, not device acceptance for
the release candidate. Current source builds use Moddable 10.1.0, unlike the
historical device measurements below.

### Retained source-head build artifacts

The following hashes were read from retained standard release outputs for
#757 head `966877ed2024868d2605bb9a5f80eea0354d2d5c`, with no tracked source
changes in that build worktree. They identify the earlier source-head builds,
not a newly built v2.1.0 artifact or the 2026-11-03 hardware run.

Toolchain: Moddable 10.1.0 `2d54ac4308501a03f45d4fcfe33beee45ee44ac4`,
ESP-IDF 6.1 `fff9895c82d744c7237be8847347bdd1b07c6643`, pinned WebRTC solution
`c8650846b512e6e1375e5f78c1c41619b8d645eb`. Both builds use release mode and the
standard host manifest.

| Artifact | Ordinary CoreS3 | M5StackChan CoreS3 |
| --- | --- | --- |
| `xs_esp32.bin` bytes | 5524176 | 7353456 |
| `xs_esp32.bin` SHA-256 | `19a804affaeacb1117528e92468b5e2bb64664bc9096a594b08164276d828b34` | `ff2c49b027d0335b20ba0f1c547e5e43d8f6a7b1b68ada3bce0d921bb7f7f271` |
| `manifest_flat.json` SHA-256 | `2d7f526954a3c4335ff14bed5fde75fdd107ed48de89578d2ce3ed4bf922daa7` | `25469f0f38e5bce12109bddf3d48d6de0f4fe655f6f99caee8df99ad863a4eb2` |
| Effective `sdkconfig` SHA-256 | `5c0b55d075033964b030dd18fbdc003ffb7016acc7705006420231487b7414d5` | `38ac24cfc06df417962cc9f09cdd1b856db3b8a79ac42a145770ac4491101236` |
| `partition-table.bin` SHA-256 | `5150c0619b8d0467983ab64faa89fdb5109efe51ef6442687bc7b9cb40e7fddd` | `5150c0619b8d0467983ab64faa89fdb5109efe51ef6442687bc7b9cb40e7fddd` |

The two candidate partition binaries are byte-identical. Comparing a generated
no-WebRTC baseline partition binary with these candidates is **NOT RUN** in
this release preparation; equality between boards is not that comparison.
The generated CSV records NVS at `0x9000` (size `0x6000`), PHY at `0xf000`
(size `0x1000`), factory size `0xf90000`, XS size `0x40000`, and storage size
`0x10000`. Device partition identity and compatibility still require live
inspection before writing; no flash operation was performed to obtain these
build hashes.

M5StackChan CoreS3 acceptance is **PARTIAL**. The unattended diagnostic run
below passed one real-downlink stop/host-audio recovery cycle and reconnected.
The second response checkpoint timed out, and its closure/recovery was not
verified. The earlier real-conversation stop failure is not established as
fully fixed. Amplifier failure recovery, acoustic listening, physical touch/UI,
all-native-task stack coverage and the common release checklist remain **NOT RUN**.
This is not a complete release-candidate hardware pass.

The maintainer explicitly deferred ordinary M5Stack CoreS3 hardware acceptance
to issue-driven follow-up for v2.1.0. It is **NOT RUN**, not PASS, and is not a
pre-publication gate for this release. Automated builds still cover that board.
This exception does not waive M5StackChan CoreS3 acceptance or establish a
cross-board hardware result.

## Unattended M5StackChan CoreS3 run (2026-11-07)

**Overall: PARTIAL, not a complete two-cycle pass.** Runtime source was
`966877ed2024868d2605bb9a5f80eea0354d2d5c`; release candidate
`5e6c56e474fec28c76e4f6228bba28725e238264` has identical runtime source and
only metadata/documentation changes. The diagnostic image was **8,271,360 bytes**,
SHA-256 `7894351175e6b95ec28a30f0ea7bdf125dc02f1e2c7a7aecf40becf98b6df64c`,
built with Moddable 10.1.0 / ESP-IDF 6.1. It was a diagnostic overlay, not an
unmodified release artifact.

Raw I2S input was zeroed before fixed offline-synthesized speech replaced the
microphone input. Output was muted. The run tested real provider traffic without
sending ambient microphone PCM; it did not test acoustic quality. Programmatic
invocation used the same `LiveSession.stop()` method as the UI, but did not
exercise physical touch dispatch or synchronous Drawer callbacks. A diagnostic
provider-send wrapper preserved its arguments, return value and payload.

### First cycle: PASS within this recipe

- Real downlink: 75,360 rendered samples; telemetry `audibleMs` 120,
  `outputIdleMs` 0, underruns 0 and overruns 0. `audibleMs` describes non-silent
  received PCM, not an acoustic listening result; speaker output was muted.
- Uplink gate: 126 successful provider-send frames, 24,000 injected samples and
  36,160 captured samples since the pre-start snapshot.
- The actual session stop reached `close.finalized`, local `session.closed`,
  native release and final idle with no active session. HTTP Workers,
  audio/radio leases and I2S ownership counters drained to zero.
- Normal host TTS completed 12 playback callbacks at volume 0. A 500 ms host
  recording produced a valid zero-PCM WAV, and normal host WAV playback returned
  true. Recording data was wiped afterward. This validates the normal host
  lifecycle with muted/zeroed data, not live-microphone intelligibility.
- This cycle passed at device uptime 24.672 seconds.

### Second cycle: reconnect PASS; response/closure/recovery incomplete

HTTP setup returned 201 and the session connected at uptime 30.012 seconds.
At uptime 60.755 seconds the 30-second response checkpoint expired. Cumulative
successful provider-send frames were 1,714, injected samples 129,520, and
raw-zero violations 0.

The checkpoint required rendered samples and non-silent PCM plus
`outputIdleMs >= 1000`. Native `outputIdleMs` counts **received silent PCM**, not
elapsed time after response completion or absence of packets. Intermediate
second-cycle downlink statistics were not retained, so missing downlink cannot
be distinguished from an unmet silence threshold. This result is **insufficient
to establish a production reconnect/audio failure**.

Second-cycle closing began, but finalized/native-release status was not
captured before bounded restoration; the second recovery was not reached.
No safe crash label/backtrace was recorded, which does not prove the absence
of a runtime problem. No further API attempt followed this timeout.

An earlier approximately 23-second attempt is **HARNESS BLOCKED**: it required
an offline capture-only probe counter in a provider session. The original app
was restored before testing the corrected observer. The corrected invocation
lasted approximately 60.75 seconds; combined bounded test windows were about
1.5 minutes. Exact billed usage and cost were not retrieved.

### Offline verification, restoration and remaining limits

The corrected final ELF was checked for provider-send and raw-zero I2S wrapper
call sites. Native observer, zero-input, fixed-speech, one-shot arming and
independent-watchdog tests passed, as did recipe tests 11/11, production session
tests 8/8 and RuntimeAudio/TTS lifecycle tests 21/21. The XS calling task's
minimum free stack was 5,476 bytes, using ESP-IDF's byte units for
`uxTaskGetStackHighWaterMark(NULL)`; other native task stacks were not measured.

Only the app range was written. The original app was restored, its complete
partition digest matched, and protected boot/table, NVS, PHY, model, MOD and
storage regions matched their pre-test hashes. No partition-table/bootloader
write or whole-device erase occurred. USB ownership returned to its original
shared Windows state. The restored firmware's app-ready marker was observed
passively after normal boot, without an extra reset.

Touch/UI regression, acoustic listening, all-native-task stacks, amplifier
fault recovery, full second-cycle acceptance and long-duration soak remain
unverified. The ordinary CoreS3 exception above is unchanged. Keep the release
Draft and the overall hardware acceptance incomplete.

## Recorded device measurements (2026-11-03)

These results cover **M5StackChan CoreS3 only**. Ordinary M5Stack CoreS3 hardware
acceptance, including its before/after idle largest internal block, is **NOT RUN**.
The boards share configuration but one board's measurements cannot substitute
for the other. The internal reserve remains 98304 bytes; these results do not
justify lowering it or claim that 96 KiB is a per-session allocation.

The runs used Moddable 10.0.2 (`80076c48f5ab87ce29de728071b7408599071a12`),
ESP-IDF 6.1 and WebRTC solution
`c8650846b512e6e1375e5f78c1c41619b8d645eb`. The candidate product source was
`dbf759939d491806ab97865591cffe048a9f1d9e`; the no-WebRTC baseline was develop
`e7e27e2f8b89b53d535717b186e88b10911fa746`. Both used release mode on the same
device, standard XS initial chunk/heap/stack (262144 bytes / 4608 slots / 768
slots), and their respective standard effective sdkconfig. Feature/allocation
policies differ: reserve/always-internal threshold changed from 32768/16384
bytes in the baseline to 98304/1024 bytes in the candidate. Total-free differences do
not isolate an allocation-policy effect or demonstrate a memory saving.

An app-only diagnostic overlay preserved settings, NVS, model, MOD and storage.
It used a built-in measurement MOD instead of the saved MOD, suppressed preference
migration writes, startup sound, power shortcuts and USB-audio autostart, and
added resource counters. The unused checkpoint was 10 seconds after the MOD hook;
the candidate had imported, constructed and closed a conversation **without
connecting**, so this is not a pure unrelated-MOD/no-import idle measurement.

Historical evidence completeness: the baseline and candidate generated
`manifest_flat.json`, binary sizes, baseline binary hash and partition-table
comparison are **NOT RUN / not recorded in this acceptance record**. The
same-boot diagnostic app hash below is available, but does not fill these gaps.
Stack high-water and audio-underrun measurements are also **NOT RUN**; the
runtime-memory acceptance requirement is incomplete. Do not reconstruct missing
measurements from source, newer binaries or a different run.

All memory values below are bytes. Workers means conversation HTTP Workers;
I2S means observed modern driver channels.

| Unused checkpoint | Internal free | Largest internal | PSRAM free | Tasks | Workers / I2S |
| --- | ---: | ---: | ---: | ---: | ---: |
| No-WebRTC baseline | 189887 | 114688 | 7775312 | 12 | 0 / 0 |
| Standard candidate after import/construct/close | 204827 | 94208 | 7732792 | 12 | 0 / 0 |

A separate same-boot run performed an API-free capture preflight, local playback,
then three connect/stop cycles with local playback after each cycle. Before any
network connection, I2S input and pre-encoder PCM were overwritten with zeros;
no surrounding audio was sent. Native counters observed zero nonzero samples
after wiping. Each connection stayed active for about five seconds. Standard
creation settings and effective sdkconfig were unchanged; zeroing, the bounded
automatic recipe, counters and preflight-warmed codec/media state are diagnostic
differences from an unmodified standard host. The measured app SHA-256 was
`70af3f47e55a70379665a75a6bdd8379581740816b5c9f1f63cf9a14f049abce`.

| Same-boot checkpoint | Internal free | Largest internal | PSRAM free | Largest PSRAM | Tasks | Workers / I2S |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before first connection, after preflight/local playback | 204459 | 94208 | 7735628 | 7602176 | 12 | 0 / 0 |
| Close 1 + 20 seconds | 203547 | 63488 | 7715144 | 6946816 | 12 | 0 / 0 |
| Close 2 + 20 seconds | 203547 | 63488 | 7715144 | 6946816 | 12 | 0 / 0 |
| Close 3 + 20 seconds | 203547 | 63488 | 7715144 | 6946816 | 12 | 0 / 0 |

**PASS, within this recipe:** all three signaling requests returned HTTP 201;
all three stops received `close_requested` and finalized native closure. All
three HTTP Workers terminated, audio/radio leases returned to zero, and all 12
observed I2S channel creations had matching deletions. Four plays of the local
`cheerup_ble_lite/assets/01-yay.wav` completed, each with 12 AudioOut played
callbacks; amplifier-rate restoration succeeded. This is driver/callback
evidence, not an acoustic listening test. The original app was restored and
protected regions were verified unchanged; USB was released.

The first-cycle largest internal block fell by 30720 bytes, then the sampled
20-second settled values were identical through cycle three. This does not
attribute the initial loss to a leak or establish long-term stability: there
was no allocation tracing or forced GC, and allocator layout, retained shared
state and XS heaps can affect the result. A previous failure after a real
conversation's manual stop was **not reproduced by this silent recipe and is
not proven fixed**. Ordinary CoreS3, transient amplifier failure, failure-path
device recovery, actual UI latency and longer repeated operation remain pending.
