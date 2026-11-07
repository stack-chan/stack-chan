# On-demand CoreS3 heap diagnostics

Release impact: **none**. These optional test manifests extend the standard
profiles in #757; normal host/MOD manifests are unchanged. No performance
manifest, task/codec/display wrapper, task census, allocation hook, heap tracing,
PSRAM-speed change, or new `sdkconfig` setting is used. This does not depend on
#744 and does not provide its audio, display, or task-stack measurements.

## Existing APIs and scope

- `realtimeConversation.stats` reports current free 8-bit/internal heap, but
  depends on a conversation and lacks the minimum/largest-block/PSRAM split.
- `jpeg-scaled-decoder.memoryUsage()` also reports current free heap/internal
  heap, with no complete lifecycle or PSRAM breakdown.
- Normal `io-performance.stats()` is a no-op. #744 supplies performance and
  task diagnostics through a separate opt-in implementation; do not enable it
  for the memory comparison.
- SDK 10.0.2's `embedded:system` provides restart/sleep, not these heap metrics.

The independent `memory-diagnostics` module calls ESP-IDF's
[`heap_caps_get_info`](https://github.com/espressif/esp-idf/blob/v6.1/components/heap/include/esp_heap_caps.h)
and `heap_caps_get_total_size`, once for `MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT`
and once for `MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT`. It requires no conversation
object, HTTPS Worker, active WebRTC transport, or API credential. Neither the
standard host nor the standard Live MOD includes this module or recorder.

## Build and select the probe

From `firmware`, after normal SDK/ESP-IDF setup and `npm ci`:

```sh
# Ordinary M5Stack CoreS3: standard manifest_local profile plus the probe only.
npm run build:memory:cores3

# M5StackChan CoreS3: standard manifest_m5stackchan_cores3 plus the probe only.
npm run build:memory:m5stackchan_cores3

# Build the idle-only MOD. No WebRTC import or connection occurs.
npm run mod:build -- --mode=release mods/examples/memory_idle/manifest.json

# Alternatively build the existing Live MOD with the diagnostic session adapter.
npm run mod:build -- --mode=release mods/examples/openai_live_webrtc/manifest.memory.json
```

These commands build artifacts; they do not write a device. Use the existing
board/partition-aware installation procedure and the device-write precautions
in [CoreS3 acceptance](cores3-webrtc-acceptance.md). Record the exact host and
MOD artifact hashes. Configure the Live MOD's existing `openaiLive` settings
locally for a provider test; do not commit keys or put them in logs. The memory
probe itself never makes an API call. Existing host audio/radio/amp ownership
and awaited-close behavior remain in `LiveSession`.

The native module must be present in the **host**; a MOD cannot add native C.
Installing the diagnostic MOD on a normal host without this module is an
unsupported configuration. To stop instrumentation, select the ordinary MOD;
to remove the native module too, rebuild the ordinary host manifest.

The optional diagnostic module can also be invoked manually in an XS debugger
or a test MOD without creating any recorder or timer:

```js
const snapshot = Modules.importNow('memory-diagnostics')
trace(`[stackchan-memory-manual] ${JSON.stringify(snapshot())}\n`)
```

`Modules` is the SDK `modules` import. Calling this allocates a result object;
avoid retaining snapshots in the target VM.

## Common log and timing contract

The idle MOD adds a **メモリ測定** drawer action. After boot/network/UI settle,
press it to emit `idle-before-use` with `cycle: 0`. Use this identical MOD and
the same settling interval for the pre/post-#757 idle comparison.

The diagnostic Live MOD emits one JSON object per line, prefixed with
`[stackchan-memory] `. It does not retain samples. Strip that prefix to obtain
JSONL; retain raw serial output separately for TLS/I2S/crash context. Each record
contains `schema: 1`, increasing `sequence`, connection-attempt `cycle`, `phase`,
actual session `state`, `atUs`, `durationUs`, `internal`, and `psram`.

| Phase | Measurement point |
| --- | --- |
| `idle-before-use` | Diagnostic LiveSession construction, after importing the conversation module but before starting a connection; cycle 0 |
| `before-connect` | `LiveSession` enters connecting, before waiting for network/acquiring audio; increment cycle even on a failed attempt |
| `negotiating` | After `Conversation.connect()` starts native transport, before awaiting its promise; follows network readiness and audio acquisition |
| `connecting` | One shot 250 ms after native transport start, only if still connecting; SDP, TLS, and DTLS may be at different stages |
| `connected` | Conversation connect promise resolves, before the UI notification |
| `duplex` | One shot 5 s after connected, if still connected; exercise mic and playback during that window |
| `before-close` | LiveSession enters closing, before awaited native close |
| `after-close` | After native close attempt and amp/radio/audio-lease cleanup; preserve `idle`, `error`, or `configuration` in `state` |
| `settled` | One shot 1 s after cleanup, unless another lifecycle transition cancels it |

There is at most one pending one-shot timer; each transition cancels it. No
repeating timer, audio-callback sampling, background task, automatic reconnect,
or connection is added. A fast transition intentionally omits its delayed
sample. Reconnect using the existing UI; compare the same phases for cycles
1, 2, ... . Keep each conversation open at least 5 s and wait at least 1 s
after cleanup for the full set. `connected`/`duplex` labels are sampling points,
not proof of audible bidirectional audio or a hardware PASS. Failure states do
not establish successful native shutdown. Snapshot/logging/timer failures cannot
block session cleanup; omitted records are missing evidence.

| Field in each memory pool | Meaning (bytes) |
| --- | --- |
| `totalBytes` | Allocator-visible capacity from `heap_caps_get_total_size` |
| `freeBytes` | Current aggregate free space |
| `allocatedBytes` | Current allocated space; allocator metadata means this need not equal total minus free |
| `minimumFreeBytes` | Sum of IDF's per-region low-water marks since boot, not a per-cycle minimum |
| `largestFreeBlockBytes` | Largest single allocatable block with the selected capabilities |

All memory is byte-addressable; internal and external pools are reported
separately. An absent PSRAM heap has zero capacity; it must not be treated as
a valid PSRAM-equipped hardware run. All fields describe allocator-visible
memory, not physical RAM, XS-only memory, or an attribution to WebRTC.
`atUs` is native monotonic microseconds since boot (not wall time);
`durationUs` spans the two pool reads. Pools are read sequentially before any
XS result allocation/stringification, not atomically across concurrent tasks.
Logging/result allocations still affect **later** samples and low-water marks.
Do not force GC, reset heap minima, or subtract the 96 KiB reserve from a
measurement: reserved-capability regions remain available for suitable
allocations and the total/maximum block are different constraints.

IDF minima can come from different instants in different regions and exclude
regions added at runtime, per the IDF API contract. This code never starts
IDF local-minimum monitoring. If another probe does so, its active interval
changes the meaning of `minimumFreeBytes`; exclude that run from this comparison.

## Comparison procedure and evidence

1. Record the board identity (ordinary CoreS3 and M5StackChan separately), host
   SHA, SDK SHA/version, IDF version, manifest/mode, effective `sdkconfig`,
   `manifest_flat.json`, binary size/hash, partition layout, MOD/settings, power
   and network conditions. Do not combine the two boards' evidence.
2. For pre/post-#757 **idle** impact, apply only this diagnostic addition to the
   pre-#757 base and to #757, using isolated worktrees/output and identical SDK,
   board, build mode, boot/network settling time, idle MOD and user actions.
   Keep each revision's standard allocation configuration unchanged. Do not
   use the larger Live performance profile. Cold-boot each run; compare current
   internal free and largest block, PSRAM and minima. The Live MOD's imported
   baseline is a separate experiment from the idle-only MOD baseline.
3. On #757, install the diagnostic Live MOD and record the initial idle and
   full lifecycle for each manually initiated connection. Run the same number
   and duration of cycles under the same conditions, including failure/retry
   cases when testing recovery. Compare current free/allocated/largest-block
   values at `settled` against prior cycles. The first cycle can retain a
   bounded HTTPS Worker in the main VM, as documented in #757; a persistent
   first-use step is different from continued growth across cycles.
4. Keep historical minima as pressure evidence; they cannot demonstrate
   recovery or isolate a cycle's lowest value. A 250 ms connecting observation
   is not guaranteed to hit a brief negotiation peak. Capture transient errors
   in the raw log and mark missing phases. Stack high-water marks, audio
   underruns, UI latency and listening checks remain separate acceptance work.
5. Record actual observations with PASS/FAIL/BLOCKED/NOT RUN and explicit
   criteria. This probe sets no invented memory margin or automatic pass rule.

## Validation status

Hardware measurement: **NOT RUN** on both boards. Firmware/MOD cross-compilation
and physical installation are **NOT RUN** in the implementation environment
(Moddable/ESP-IDF toolchains and connected boards are unavailable).

Node tests execute the recorder, the existing LiveSession cleanup sequence,
and the actual native snapshot C with stubbed heap/XS APIs. The C fixture checks
capability selection, acquisition before result allocation, field mapping,
updated snapshots, retained IDF minima and absent PSRAM. Fixture values are
synthetic test inputs, never device evidence. Run the focused tests with:

```sh
node --test host/modules/realtime-conversation/__tests__/memory-diagnostics.test.mjs
```
