---
'stack-chan': major
---

Add `Synthesis.flush()` so OpenAI Speech, StackchanVoice, and sanoTTS can emit multiple text segments through one PCM source without closing text input. Custom TTS implementations must implement this method. Bound text and segment bookkeeping, preserve native PCM backpressure, and wait for resource cleanup on cancellation.

Define STT updates as full-utterance snapshots and make Whisper finalization idempotent, preventing duplicate requests and late transcript delivery after cancellation. Whisper still uploads buffered audio at finalization.
