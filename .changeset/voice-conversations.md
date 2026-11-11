---
'stack-chan': major
---

Voice MODs now connect cascaded and realtime conversations through a shared microphone and speaker pipeline. The OpenAI Live entry point is `createLiveConversation`. Rebuild voice MODs against the new host API. Camera observations use the same Responses model as text agents.

Standalone speech engines are selected with `robot.audio.useSpeechPlayback(playback)`. The synthesis-only `TTS` contract in `stackchan/voice` supplies audio to the conversation speaker.
