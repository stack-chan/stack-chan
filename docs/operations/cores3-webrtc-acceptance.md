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
the release candidate. Current source builds use Moddable 10.1.1, unlike the
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

M5StackChan CoreS3 **two-cycle lifecycle acceptance passed within the final
diagnostic recipe** below. Each cycle received real downlink, used the actual
session stop method, released resources and recovered normal host audio.
Cycle 2 recorded four underruns of undetermined cause. Acoustic quality,
physical touch/UI, amplifier fault recovery, long-duration stability,
all-native-task stack coverage and the common release checklist remain
unverified. This is not a complete release-candidate hardware pass.

The maintainer explicitly deferred ordinary M5Stack CoreS3 hardware acceptance
to issue-driven follow-up for v2.1.0. It is **NOT RUN**, not PASS, and is not a
pre-publication gate for this release. Automated builds still cover that board.
This exception does not waive M5StackChan CoreS3 acceptance or establish a
cross-board hardware result.

## Unattended M5StackChan CoreS3 run (2026-11-07)

**PASS: two consecutive real-audio lifecycle cycles, within this diagnostic
recipe.** This is not acoustic-quality, touch/UI or overall release acceptance.
Runtime source was `966877ed2024868d2605bb9a5f80eea0354d2d5c`; release candidate
`5e6c56e474fec28c76e4f6228bba28725e238264` and subsequent evidence-only commits
have identical runtime source. The final diagnostic image was **8,271,360 bytes**,
SHA-256 `7dc5410ca95d9597d1711edfa23ebb0f7b270c70ac3d51050f761afd51cd82b0`.
It is a diagnostic overlay, not an unmodified release artifact.

The retained final binary hash/size matched the tested image before the
adjacent generated metadata was hashed:

- Moddable 10.1.0 SHA: `2d54ac4308501a03f45d4fcfe33beee45ee44ac4`.
- ESP-IDF 6.1 SHA: `fff9895c82d744c7237be8847347bdd1b07c6643`.
- Diagnostic `manifest_flat.json` SHA-256:
  `4ca01177e5b1ff205211978f584cc06ddeb6a8084fb9d4b421355acd69f4f675`.
- Diagnostic effective `sdkconfig` SHA-256:
  `3028d1c71acb25e40c44b1ff7f36385b2bfa7977797bc09e82b0f66dc51affb5`.

The overlay supplies a built-in no-touch MOD, fixed offline-synthesized input,
raw microphone zeroing, muted output, counters, one-shot arming and independent
deadlines. Product source and shared SDK source were unchanged. Both sessions
used fresh native stats; upon receiving rendered and non-silent PCM, the
harness explicitly invoked the actual `LiveSession.stop()` method. It did not
use `outputIdleMs` as a response-completion indicator. Physical Drawer touch
dispatch and synchronous UI callbacks were not exercised. `session.closed` is
a local lifecycle event, not proof of remote hangup acknowledgement.

### Final measured cycles

| Measurement | Cycle 1 | Cycle 2 |
| --- | ---: | ---: |
| Rendered samples at downlink checkpoint | 110880 | 103200 |
| Non-silent PCM duration before volume scaling | 450 ms | 420 ms |
| `outputIdleMs`, informational only | 200 | 50 |
| Underruns / overruns at checkpoint | 0 / 0 | 4 / 0 |
| Injected samples since pre-start snapshot | 28480 | 40640 |
| Captured samples since pre-start snapshot | 42240 | 40640 |
| Successful provider-send frames since pre-start snapshot | 169 | 159 |
| `close.finalized`, native release, idle, no active session | PASS | PASS |
| Normal local TTS and playback callbacks | PASS; 12 | PASS; 12 |
| 500 ms normal host recording and WAV playback | PASS | PASS |
| Zero PCM recorded, then wiped | 16000 bytes | 16000 bytes |

The second cycle reconnected after first-cycle recovery. At completion, HTTP
Workers were created 2 / terminated 2 / outstanding 0; audio and radio leases
were 0; I2S channels were created 10 / deleted 10 / current 0 / enabled 0.
Raw-zero violations were 0. Both cycle-pass and trial-complete snapshots
confirmed release. Cumulative successful provider-send frames were 437.
Output was muted: non-silent PCM counters are not a listening result.
The cause and acoustic impact of cycle 2's four underruns remain undetermined.

The XS calling task's minimum free stack was 5476 bytes via
`uxTaskGetStackHighWaterMark(NULL)`, using ESP-IDF's byte units. Other native
task stacks were not measured. Completion observations: internal free heap
198087 bytes, minimum observed 41744 bytes, largest free block 94208 bytes;
PSRAM free 7680960 bytes. These are bounded diagnostic observations, not
unrestricted memory or stack guarantees.

### Offline checks and earlier attempts

Recipe tests passed 12/12, including independent fresh stats for both sessions;
production session tests passed 8/8 and RuntimeAudio/TTS tests 21/21. Native
provider-send observer tests preserve arguments, return and payload and count
only successful nonempty frames. Raw-zeroing, fixed speech, one-shot arming
and a 150-second independent watchdog passed offline tests. Final ELF call
sites, controller syntax, telemetry allowlist and the 160-second absolute host
deadline were checked. Cleanup cannot extend that deadline.

The first earlier attempt was **HARNESS BLOCKED** by using an offline-only
probe counter in a provider session. The next passed one cycle and reconnected,
but its 30-second checkpoint mistook received silent PCM (`outputIdleMs`) for
general response completion. Its second closure was not observed, rather than
proven to have failed. These observer/criterion limitations were corrected
offline before the final run; they are not established production regressions.

Final trial-complete was at device uptime 39.796239 seconds. The measured host
arm-to-capture-end interval was 46.056 seconds; arm-to-restoration bootloader
connection was 47.832 seconds. Earlier terminal uptimes were about 23.24 and
60.75 seconds, but their exact host arm/reset intervals were not retained.
These timings are not billing durations; actual usage/cost was not queried.
No further API/device attempt followed the final successful run.

### Restoration and remaining limits

Raw microphone PCM was zeroed before network capture; only fixed synthetic
speech or zeros entered the provider. No ambient PCM, credential values,
packet payloads or raw serial logs were retained.

Only the app range was written. The live device retained its application range
`[0x10000, 0xef0000)` and a separate model partition. The generated standard
bundle table was not written or treated as the live layout. Full-bundle
migration compatibility remains **NOT RUN**.

The original app's entire partition digest matched after restoration, and
protected boot/table, NVS, PHY, model, MOD and storage regions matched their
pre-test hashes. USB returned to its original shared Windows state. The
restored original firmware emitted its app-ready marker after 9.075 seconds
of passive observation, with no extra reset. No bootloader/partition-table
write, whole-device erase or persistent permission change occurred.

Keep the release Draft. Physical touch/UI regression, acoustic quality,
amplifier fault recovery, all-native-task stacks, long-duration soak and the
common release checklist are not certified by this test. Ordinary CoreS3
hardware remains deferred under the explicit scope exception above.

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
