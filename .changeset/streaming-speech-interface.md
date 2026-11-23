---
'stack-chan': minor
---

Bound sanoTTS streaming synthesis to 64 segments and 4,096 UTF-16 code units per session. Reuse one PCM source across segments, apply backpressure to the native renderer, and keep the provider reserved until native cleanup succeeds.
