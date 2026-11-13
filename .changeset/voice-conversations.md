---
'stack-chan': major
---

Voice MODs now connect cascaded and realtime conversations through a shared microphone and speaker pipeline. Public constructors use companion `X.create()` methods, including `LiveConversation.create()`. Rebuild voice MODs against the new host API. Camera observations use the same Responses model as text agents.

Standalone speech engines are replaced with `robot.audio.setSpeechPlayback(playback)`, which returns the previous engine for restoration. The synthesis-only `TTS` contract supplies audio to the conversation speaker and separates reusable `flush()`, terminal `endInput()`, and cancellation with `close()`.

Conversation submissions report whether response playback can be tracked. Await a tracked submission's `done` before sending the next turn. Microphone muting can be configured before startup with `setMicrophoneMuted()`. See `firmware/docs/voice-quickstart.md` and `firmware/docs/voice-api-migration.md` for capability limits, cleanup semantics, and the minimal example.
