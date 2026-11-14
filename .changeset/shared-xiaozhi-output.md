---
"stack-chan": minor
---

Add exclusive XiaoZhi turn control to ChatService. The default halfDuplex mode and the new downlink mode share the Worker decoder, bounded PCM ring, and audio output. Downlink does not allocate microphone resources or start listening. Unsupported fullDuplex fails before creating resources. Add local playback hooks with FIFO turn boundaries and cancellation-safe identities.
