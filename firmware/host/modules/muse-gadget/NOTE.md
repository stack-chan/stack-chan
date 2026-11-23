# Muse voice-note Conversation

This path deliberately does not call `/voice/realtime`.

The StopWatch captures at most 15 seconds of mono PCM16 at 16 kHz while the
talk button is held. On release it sends one WAV voice note through Muse's
ordinary `/chat/stream` API. Muse owns both recognition and answer generation.
A dedicated side chat and acknowledged message IDs bind replies to the turn.
Replies are displayed and, for voice-modality replies, fetched as MP3 from
Muse's ordinary TTS endpoint and converted from 24 kHz mono to 16 kHz PCM.

## Interface boundary

`note-conversation.js` implements the existing Conversation interface, not STT.
It does not invent an input transcript or call a separate LLM after Muse has
already answered. This replaces ASR plus agent processing as one provider
operation. It shares the existing pipeline's microphone/speaker ownership.
`chat-agent.js` remains an optional text-only Agent for cascaded integrations.

The provider cannot cancel remote work reliably. Local interruption fences
playback and requires a new conversation. Closing an in-flight request reports
remote finalization as unknown, rather than claiming remote cancellation.
Recording overflow discards the whole recording, not a silently truncated note.

## Credentials and scope

The existing approved on-device account and Wi-Fi records are reused. No new
provider key, pairing export, remote shell capability, or Link registration is
required. The account-native transport retains credential handling in native
code. Diagnostics do not print tokens, user audio, or reply text.

## Evidence

An independently paired, unchanged official Linux SDK at commit
`aa43f0f7685cdd53d0e940362dbc3ac028f532a8` successfully performed:

- normal chat request, correlated complete greeting reply;
- voice-modality reply TTS, 7,104 bytes of 24 kHz mono MP3;
- that synthetic greeting converted in RAM to 16 kHz WAV, submitted as a voice
  note, followed by a correlated complete acknowledgment reply.

No microphone capture or speaker playback was used for this host control.
The same official host returned HTTP 404 on realtime voice admission. These
results establish the ordinary service path, not StopWatch hardware operation.
Hardware build and device checks must be recorded separately.

## StopWatch verification (2026-11-16 JST)

The real StopWatch completed the synthetic Conversation round trip: fixed
16 kHz PCM fixture, voice-note upload, correlated reply, Muse TTS download,
native MP3 decode/resample, actual speaker-driver DMA drain, played receipt,
and clean Conversation shutdown. Speaker volume was zero and the microphone
was never opened. This verifies the service and device pipeline, not audible
quality or the user's microphone input.

The integration required canonical UUID session IDs, complete 65,535-byte
Noise frame delivery, a fixed 256 KiB NDJSON line buffer, a bounded 32-event
native queue, filtering retired replay before acknowledgment buffering, and
separate turn-cancellation and PCM playback generations. Native delivery keeps
the event type separate from payload length to avoid 16-bit length overflow.

Host contract tests: 174 passed. Native sanitizer tests cover receive/frame
boundaries, copied delivery lifetime, queued close, and request framing. The
pre-existing pairing vendor provenance test is excluded from that count: local
pairing patches differ from upstream hashes and are documented separately.

The normal setup image is 2,114,240 bytes, below the 2,228,224-byte app limit.
It includes the Kasane neutral/speaking artwork and physical A hold/release to
talk, B to disconnect and discard unfinished capture. Actual microphone,
audible playback, button operation and visual confirmation remain human
acceptance checks. Synthetic test profiles are separate from the normal UI;
they must not be left installed because they repeat their fixed test on boot.

## Latency and playback investigation (2026-11-16 JST)

The fixed 120,160-byte synthetic PCM fixture reproduces the reported delay
without recording the user. Probe timestamps separate release, POST, upload
completion, reply, TTS download and speaker drain.

- Previous POST upload: 17.604 s; encoding 15.419 s and native sending 2.052 s.
- With the SDK native `Uint8Array.toBase64()` in bounded 3,072-byte blocks:
  upload 2.567 s; encoding 0.113 s and sending 2.357 s.
- The same player/output timing test failed with the old short-write adapter:
  1.152 s PCM required 6.138 s of sequential DMA callbacks.
- The StopWatch adapter now copies short writes into one 4,092-byte staging
  block and awaits full-block acceptance. A real 78,720-frame reply (4.920 s)
  drained in 5.912 s, including the conservative seven-block silence tail.

These are silent hardware pipeline measurements, not a claim of audible quality.
One comparison attempt encountered TCP transport failure before playback; a
retry completed. Service response and TTS generation time remain variable.

The SDK Async example prequeues buffers; its Sync example fills onWritable
credit. This fix follows those practices while retaining bounded ownership.
C/Worker migration of the whole pipeline was not required: the measured CPU
hotspot was base64 generation, now using the SDK's existing C implementation.
UI drawing may still affect callback latency and needs a separate full-UI check.

## UI playback continuity follow-up

A user still heard severe gaps after the first pacing fix. The silent/no-UI
round trip did not establish continuity under display load. An audible-volume
0.25 probe with the real avatar rendering reproduced that remaining fault:

| Output / UI | PCM seconds | Open-to-drain seconds | DMA empty-credit samples |
| --- | ---: | ---: | ---: |
| Async staging, no UI | 5.040 | 6.040 | 46 / 46 |
| Async staging, whole-view mouth updates | 5.640 | 15.377 | 117 / 117 |
| Sync credit, whole-view mouth updates | 4.368 | 10.905 | 79 / 83 |
| Sync credit, mouth rectangle only | 2.688 | 3.103 | 3 / 24 |
| Sync credit, mouth-only fixed 4 fps, no levels | 4.800 | 5.149 | 0 / 40 |

The final case had maximum native write gap 129 ms, zero partial native writes,
and zero empty MP3 decode frames out of 200. Each response differs in length;
compare normalized duration and occupancy, not raw seconds alone. Empty credit
is a starvation indicator, not a direct measurement of DAC samples. The final
run is stronger evidence than total completion time alone, but the person's
hearing remains the final sound-quality acceptance check.

The output now uses synchronous writes against SDK onWritable credit, filling
existing ring capacity before waiting. The avatar uses a fixed 250 ms mouth
clock only while playback is active, invalidates only the mouth rectangle,
and closes on stop/error/cancellation. Setup disables level collection entirely;
other providers keep their default behavior. Native decoding remains in the
existing C implementation; a Worker was not needed to resolve the measured
render/notification contention.

SDK DMA counters were a temporary opt-in diagnostic patch. The working SDK was
restored after measurements; the patch is retained under tests for reproducing
the investigation, not installed in ordinary builds.
