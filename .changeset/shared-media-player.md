---
"stack-chan": minor
---

Add a Media Player MOD to the Gallery with Podcast and MP3 WebRadio mini apps sharing one playback controller. Reuse Podcast feeds, artwork, pause/resume and seeking; switch playback explicitly, preserve audio when closing a view, and prevent inactive controls or old callbacks from stopping the current stream.

Add a shared saved audio volume based on `tts.volume`. The MOD Drawer offers high, medium, low and mute; arbitrary values from settings remain unchanged until a preset is selected. Apply changes to the current media stream without reconnecting and to subsequent TTS/tone playback. Media keeps its existing maximum gain of 0.2. This MOD requires the updated CoreS3 host.

Add an opt-in Look Around Drawer toggle using the existing motion API. It starts off, stops gaze updates and releases torque when disabled, and preserves configured driver/servo interlocks.

Declare `audio.volume` as host API 2 so the Gallery rejects older hosts before writing the MOD. Show the host-update message when started manually on an older host, and keep new player registration working if cleanup of a previous Look Around controller fails.

The standalone WebRadio MOD also follows the saved `tts.volume` instead of a fixed gain: the default 50% setting now gives gain 0.1 rather than 0.2. Maximum gain remains 0.2 and the shared mute setting is respected.
