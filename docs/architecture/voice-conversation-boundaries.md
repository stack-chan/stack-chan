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
| Local wake detector | Whether to leave the waiting state | ASR result or conversation turn |
| VAD, proposed | Whether speech-like audio has begun or ended | Semantic completeness or turn commit |
| STT/ASR | Recognized text and recognition stability | Permission to execute a tool |
| TurnDetector | When client-controlled input is ready for one turn | Provider turn control |
| Conversation | How committed input produces a response | A particular STT→LLM→TTS implementation |

Partial recognition and partial model text are useful for display. They must not trigger irreversible tool effects. A recognized keyword can improve transcription accuracy without being an interruption or wake keyword. Agora exposes these as separate controls: [ASR vocabulary keywords](https://docs.agora.io/en/ai/platform/build/shape-the-conversation/asr-keywords) and [speech interruption modes and keywords](https://docs.agora.io/en/ai/platform/build/shape-the-conversation/interrupt-agent). Those provider features are references for the boundary, not implemented Stack-chan options.

## Opt-in wake-word handoff on M5StackChan CoreS3

The [optional M5StackChan CoreS3 host manifest](../../firmware/host/app/manifest_m5stackchan_cores3_wakeword.json) adds a local WakeNet detector for “Hi, Stack Chan.” It is used by the existing [OpenAI Live WebRTC MOD](../../firmware/mods/examples/openai_live_webrtc/README_ja.md#ウェイクワードで開始対応ホストのみ), with waiting off by default. The stock build does not include the detector or model. An unavailable detector or a known busy state that took no audio ownership does not prevent a later explicit manual conversation if audio is available.

`AudioRuntime.acquire()` reserves the microphone and speaker together. While waiting, the detector holds that paired lease at 16 kHz mono and cannot run alongside another audio owner. It emits a wake event, not a transcript or a turn. The coordinator waits for confirmed release before letting the conversation acquire a new lease. It neither shares the microphone nor hands over a stream. Detection uses local samples with `preRollMs: 0`; neither the wake utterance nor preceding samples are forwarded to the conversation. The existing turn and provider boundaries stay the same.

Explicit Stop disarms waiting and stops the session; muting while waiting also disarms the detector. Only natural conversation completion can return to waiting, and only if waiting is still enabled and the same session's underlying audio lease has been positively released. Runtime detector/provider errors do not trigger a retry. An ambiguous acquisition or failed release blocks another owner rather than assuming the device is free. Late events from an earlier owner cannot start or reopen a session.

The separate `preRollMs` contract is still scoped to one acquired session. It is not a wake-word store, cross-session transfer mechanism, or permission to send audio captured before activation. On-device recognition and its latency, accuracy, and resource use still need hardware validation.

## Make the entry point executable

Agora's [AI developer toolkit](https://docs.agora.io/en/introduction/start-with-ai) separates documentation discovery, environment setup, and runnable recipes. For this repository, the corresponding first step is the checked-in [minimal voice example](../../firmware/mods/examples/minimal_voice/README.md), accompanied by an offline workflow test and a buildable MOD manifest. The example is the starting point for a newcomer; the adapter guide contains the lower-level extension contracts.

Source pages above were read on 2026-11-13. They motivate the responsibility boundaries; they do not establish device performance, provider compatibility, or acceptance of this firmware implementation. Those require their own executable tests and hardware validation.
