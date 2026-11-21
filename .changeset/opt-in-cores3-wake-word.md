---
'stack-chan': minor
---

Add optional local “Hi, Stack Chan” wake-word detection to the OpenAI Live WebRTC MOD on M5StackChan CoreS3. Waiting is off by default and requires the optional host build; stock firmware and manual conversation are unchanged. Wake detection releases its exclusive audio lease before conversation starts and sends no pre-wake audio. Explicit Stop disarms waiting. Recognition on physical hardware has not yet been verified.
