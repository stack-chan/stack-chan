---
"stack-chan": patch
---

Serialize finite firmware audio playback with bounded queues and deadlines, and cancel pending playback when its owner closes.
Share native and simulator playback cleanup, reject unavailable simulator TTS providers, and prevent cancelled speech rendering from modifying its successor.
Detach motion drivers on shutdown, suppress late motion callbacks, and handle immediate PWM moves without invalid output values.
