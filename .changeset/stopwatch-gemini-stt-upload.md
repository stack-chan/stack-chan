---
"stack-chan": patch
---

Reduce the work done after releasing Talk when using Gemini transcription on StopWatch. Only the selected speech provider receives the recording; no transcription text or audio is added to the timing trace.

Buffer long Gemini replies for uninterrupted playback and keep the Muse session ready for the next turn after a speech synthesis failure.
