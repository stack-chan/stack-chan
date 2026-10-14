---
"stack-chan": patch
---

Limit the dedicated M5StackChan servo driver's default pitch range to the manufacturer's recommended 5–85° to avoid mechanical endpoints that can stall or damage the servo. Neutral and out-of-range pitch requests are clamped to this range; existing calibration and explicit axis-limit overrides remain supported.
