---
'stack-chan': patch
---

Prevent CoreS3 from restarting when push-to-talk uploads a Whisper recording. Keep recorded PCM outside the fixed XS chunk heap, unwind the caller's native stack before HTTPS setup, and reserve 15 KiB for the CoreS3 XS task's native stack.
