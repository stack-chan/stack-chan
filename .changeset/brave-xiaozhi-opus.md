---
"stack-chan": major
---

Replace the server-backed OpenAI Realtime adapter with XiaoZhi WebSocket v1 and raw Opus on M5StackChan CoreS3.
Configurations must migrate to `chat.type: "xiaozhi"`; the previous server adapter is no longer supported.
The transport was validated on CoreS3 hardware with uninterrupted playback and sustained bidirectional audio.
