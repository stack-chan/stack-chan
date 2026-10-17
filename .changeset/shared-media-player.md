---
"stack-chan": minor
---

Add a Media Player MOD to the Gallery with Podcast and MP3 WebRadio mini apps sharing one playback controller. Reuse Podcast feeds, artwork, pause/resume and seeking; switch playback explicitly, preserve audio when closing a view, and prevent inactive controls or old callbacks from stopping the current stream.

Add a shared saved audio volume based on `tts.volume`. The MOD Drawer offers high, medium, low and mute; arbitrary values from settings remain unchanged until a preset is selected. Apply changes to the current media stream without reconnecting and to subsequent TTS/tone playback. Media keeps its existing maximum gain of 0.2. This MOD requires the updated CoreS3 host.
