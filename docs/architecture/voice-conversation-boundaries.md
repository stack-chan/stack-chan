# Conversation boundaries and future voice input

The current implementation shares device ownership, audio routing, cancellation, and conversation events. It does not require every provider to expose the same internal processing stages.

## Cascaded and direct realtime conversations

A cascaded conversation runs STT, an Agent, and TTS under client turn control. A direct realtime model may receive audio and produce audio without exposing a separate STT or TTS. Agora's [Gemini Live integration](https://docs.agora.io/en/ai/models/mllm/gemini) documents that direct audio arrangement. The shared Stack-chan contract therefore describes a Conversation rather than pretending a realtime model supplies three replaceable components.

`ConversationPipeline` acquires audio and owns a `ConversationSession`. The strategy in `Conversation` declares its audio requirements and capabilities. A provider-controlled session is the sole owner of its turn commits. A client TurnDetector must not independently commit the same audio as a second owner.

Capabilities are not promises about every model behind an adapter. A cascaded conversation can carry images, but the selected LLM must support them. A provider that cannot correlate submitted text with a response reports `submitCompletion: 'unavailable'`. Applications must not infer correspondence from the next unrelated playback event.

## Recognition, speech boundaries, and turn commits

`Transcript` is a complete current text snapshot for a provider-defined `utteranceId`. `final: true` means that recognition segment will not be revised. It does not mean that a user has finished speaking or that the application has committed a turn. A provider that supplies only deltas without utterance boundaries emits `input.transcript.delta` with a stream identifier instead; it does not fabricate final utterances.

The present cascaded adapter expects one complete final utterance snapshot from its STT. It keeps the final text for that utterance; it does not concatenate final segments from unrelated IDs. An ASR adapter with segment-level finals must aggregate those segments into the requested utterance snapshot before returning `Transcription.finish()`. The PushToTalk detector converts that final snapshot into `turn-ready` after the recording has ended. A future continuously streaming detector must establish its own explicit utterance-completion policy.

The responsibilities remain separate:

| Component | Decision | Does not imply |
| --- | --- | --- |
| WakeWordDetector, proposed | Whether to leave the waiting state | ASR result or conversation turn |
| VAD, proposed | Whether speech-like audio has begun or ended | Semantic completeness or turn commit |
| STT/ASR | Recognized text and recognition stability | Permission to execute a tool |
| TurnDetector | When client-controlled input is ready for one turn | Provider turn control |
| Conversation | How committed input produces a response | A particular STT→LLM→TTS implementation |

Partial recognition and partial model text are useful for display. They must not trigger irreversible tool effects. A recognized keyword can improve transcription accuracy without being an interruption or wake keyword. Agora exposes these as separate controls: [ASR vocabulary keywords](https://docs.agora.io/en/ai/platform/build/shape-the-conversation/asr-keywords) and [speech interruption modes and keywords](https://docs.agora.io/en/ai/platform/build/shape-the-conversation/interrupt-agent). Those provider features are references for the boundary, not implemented Stack-chan options.

## Wake-word handoff is not implemented

`AudioRuntime.acquire()` currently reserves the microphone and speaker together. Two pipelines cannot concurrently acquire the same runtime. Starting a wake-word pipeline beside a conversation pipeline would fail with `device_busy`; it does not establish shared microphone access.

A future wake-word design needs an explicit owner transition. The owner of the microphone would retain a bounded local pre-roll buffer while waiting, detect a wake event, stop or suspend the detector, and transfer the approved pre-roll and live stream to the conversation. The handoff must define exactly when samples stop belonging to the detector and start belonging to the conversation. It must avoid duplicate or missing samples and stale callbacks after cancellation. It also needs a defined return transition after normal completion, failed startup, interruption, and provider disconnect.

That design must resolve the following before adding a public API:

- Whether waiting reserves only input or the present duplex lease, and which existing playback functions can coexist.
- Which component owns the pre-roll memory, its sample rate, maximum duration, overwrite policy, and release point.
- Whether wake detection is entirely local, and precisely which pre-wake samples may leave the device after user consent.
- How a microphone mute request clears or stops capture, pre-roll retention, and any pending handoff.
- Whether the client or provider owns turn commits after handoff, with exactly one active owner.
- How cleanup failure keeps an unsafe device reservation isolated rather than granting it to a new owner.

The current `preRollMs` is a request used by a TurnDetector within one acquired session. It is not a wake-word store, cross-session transfer mechanism, or permission to upload audio recorded before activation. Wake detection, a shared microphone lease, and cross-session handoff remain unimplemented.

## Make the entry point executable

Agora's [AI developer toolkit](https://docs.agora.io/en/introduction/start-with-ai) separates documentation discovery, environment setup, and runnable recipes. For this repository, the corresponding first step is the checked-in [minimal voice example](../../firmware/mods/examples/minimal_voice/README.md), accompanied by an offline workflow test and a buildable MOD manifest. The example is the starting point for a newcomer; the adapter guide contains the lower-level extension contracts.

Source pages above were read on 2026-11-13. They motivate the responsibility boundaries; they do not establish device performance, provider compatibility, or acceptance of this firmware implementation. Those require their own executable tests and hardware validation.
