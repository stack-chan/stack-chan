# Muse voice backend

This is an opt-in native backend, separate from the local STT/LLM/TTS cascade. `voice-client.js` composes the public Conversation interface with `voice-bridge.js`, the upstream protocol core, and the existing XS/Noise transport. The public API is not changed.

## Public and service-side responsibilities

The SDK publishes the Noise transport, HTTP-over-Noise routes, admission, PCM framing/resampling, response gating, turn settlement and call teardown. Those are reused here. Server-side recognition, inference, synthesis and authorization remain the service responsibility; this module neither reconstructs them nor treats a generic HTTPS request as a substitute.

The opt-in transport takes `host`, `vmId`, `token` (owner WsBearer), `appId` and stable `nodeId`. An SDK `mgst` token is not interchangeable with the owner bearer. Credentials are only used in the TLS upgrade header, not transcript logs. Pairing, token issuance/refresh and account setup are not implemented by this module. Do not copy credentials into source or tests.

Voice core provenance and exact hashes are in `firmware/vendor/muse-gadget-sdk/voice_core/VENDOR_SOURCE.json`. Noise has its own existing pin in the parent vendor directory. The binding keeps the upstream bounded turn/reply state rather than reimplementing settlement in JavaScript.

## Semantics

- Microphone and speaker media are 16 kHz mono PCM16; the core converts the 24 kHz wire format.
- A matching call/session admission is required before capture or playback.
- PTT fences local playback. It does not promise cancellation of remote inference.
- Provider turn settlement is not PCM finality. `submitCompletion` is `unavailable`; playback receipts are separate from provider turn events.
- `/voice/end-call` is explicit. Transport disconnection, media closure or a timeout alone must not be reported as confirmed remote finalization.
- Transcript text is forwarded to the UI, not logged.
- `session.ended` carries the final `CloseResult` after the backend detaches its native resources. The pipeline closes the session idempotently, releases the audio lease, then forwards the event. The Muse MOD returns to idle so the next press creates a new session. Providers that do not emit this optional event keep their existing explicit-close behavior.
- Service-frame reassembly is capped at 64 KiB, matching the upstream session scratch budget; websocket frames and outbound bodies retain their smaller bounds. NDJSON lines are capped at 32 KiB.

## Checks and limits

The native device harness contains no network configuration and starts no call. It tests loading and calling the actual XS binding on StopWatch. Build from `firmware` with the StopWatch-capable Moddable SDK and ESP-IDF environment:

```
node scripts/build-muse-native-device.mjs
```

This command uses the repository build wrapper and `firmware/dist`; it does not flash. Flash only the app image at the device's verified app offset, preserving NVS and the partition table. Hardware access must be coordinated with other work.

A standalone StopWatch Piu host is provided under `device-host`, with an SDK codec/amplifier adapter under `stopwatch-audio`. Live pairing, actual microphone/speaker conversation and kasane v1.1 service interoperation remain unverified; the offline checks do not establish service compatibility.

## Verification record

- StopWatch SDK commit `69158293`, Moddable 10.1.1, ESP-IDF 6.1: native/core and Conversation factory harness builds.
- COM18 app-only flash at `0x20000`: 923,280-byte test image, hash verified, existing partition table retained. Serial confirmed admission/session validation, 1,280-byte input PCM framing, explicit end-call action, safe close and Conversation factory. Thirty-second observation completed without a panic. No socket was opened.
- The pinned upstream `VoiceCallCore` tests pass with ASan/UBSan (11 cases).
- The actual XS binding is tested under `x-cli-lin`, including turn tracking, audio conversion, reply capacity, STOP tail and use-after-close rejection.
- Mock transport tests verify the JavaScript orchestration but are not evidence of service compatibility or audible quality.

Run the native/core checks from `firmware` in a compiler-equipped environment:

```
node --test host/modules/muse-gadget/__tests__/*.test.mjs
node scripts/test-muse-native.mjs
python3 scripts/test-muse-voice-core.py
sh host/modules/muse-gadget/__tests__/voice-core-xs/run.sh
```

### StopWatch host and audio checks (2026-11-15)

- Build the standalone host with `node scripts/build-muse-native-device.mjs --host`; build the offline microphone/output probe with `--audio`.
- The 593,344-byte audio probe was flashed to COM18 at app offset `0x20000` only. Its one-second capture received 16,384 samples, with 973 nonzero samples (peak 227, RMS 9). Only these aggregate metrics were logged; no microphone recording was stored or transmitted.
- The low-volume 100 ms tone produced a `played` receipt for 1,600 frames at 16 kHz, followed by successful lease close and reacquisition. The receipt has estimated position; physical audible quality was not independently observed.
- The presence-only NVS probe reported all five required Muse settings and both Wi-Fi settings absent. It made no network connection or preference write. Pairing was not created.
- `session.ended` lifecycle tests cover terminal-event cleanup, reentrant explicit close, startup termination and release-failure quarantine. The pipeline, scope and contracts pass a strict, no-emit TypeScript check. The actual XS voice core and bridge tests still pass.
- JavaScript tests that mock Moddable modules require Node's `--experimental-vm-modules` flag.
- The corrected 1,573,232-byte standalone host was flashed app-only. During a 30-second capture, one early software reset was followed by MUSE_HOST boot and the seven-field presence report; no further reset or init failure appeared in the remaining approximately 20 seconds. Missing settings kept the host offline. Screen appearance and live conversation still require separate confirmation.

## Provisioning boundary

The current Moddable host is not a pairing application. Its `muse` and `wifi` preferences are distinct from the official SDK's `homehub` namespace. An absent Moddable preference does not prove the device has never been paired. The offline native harness enumerates expected key names through `Preference.keys`, without reading values, to distinguish these cases.

At the pinned upstream revision, official community pairing v5 uses the Muse phone app, an explicit physical confirmation on the gadget, and encrypted provisioning. The SDK stores Wi-Fi and access/refresh tokens in `homehub`; obtaining a VM bearer also involves the official account API. These are not a direct five-field substitution. The developer SDK token (`mgst_...`) is separate from the bearer used for voice calls. This port does not mint tokens or accept SDK Terms.

Do not ask the owner to paste a bearer into a chat, source file, manifest or shell argument. A future local provisioning path should accept secrets without echo, keep them in process memory while transferring them to the connected device, and log only success/failure. Writing the requested keys must preserve other NVS namespaces and the partition table. The upstream SDK's developer-token serial console logs a token prefix, so it is not suitable unchanged for a strict no-secret-output workflow.

Primary references at voice-core pin `f2c702b123e97f4fecdaefb29ded17bb03fab0b0`:
- `esp32/AGENTS.md`, first boot/pairing and developer SDK token instructions.
- `esp32/main/config_store.c` and `.h`, `homehub` namespace and setup keys.
- `esp32/main/link_pairing.h`, encrypted confirmation and session-bound provisioning.
- `esp32/main/sdk_token_console.c`, developer-token console behavior.
The metadata-only COM18 probe on 2026-11-15 found all 15 expected keys absent across muse (5), wifi (2), and official SDK homehub (8). It used Preference.keys only and did not fetch values. The 931,424-byte app-only probe and 15-second serial check completed successfully, preserving NVS and partitions. This device currently has no reusable configuration under those expected keys.
