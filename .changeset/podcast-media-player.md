---
"stack-chan": minor
---

Add a Podcast MOD for M5StackChan CoreS3 with configured RSS feeds, episode selection, and finite MP3 playback through a mini app.
Keep playback and face effects running after the app closes. Add play/pause and stop icons, output-based progress, and a seek bar with frame-based MP3 seeking and HTTP Range retrieval.
Share the host audio owner with WebRadio; support HTTP redirects, leading ID3 tags, 44.1/48 kHz MP3 input, and an ended notification after queued audio drains.
Keep live reconnects at the current stream position and resolve redirects again when resuming or seeking, so expired CDN URLs are refreshed. Reject HTTPS-to-HTTP redirects for feeds, audio, and artwork.
Load and parse RSS in a Worker when the app first opens, with a 256 KiB feed limit and up to 20 episodes. Show feed errors beside episode selection and playback state beside the seek bar; offer refresh after a feed error.
Display episode or show artwork as a 64×64 thumbnail using bounded streaming JPEG download and decoding with TLS certificate verification. Support baseline JPEG up to 4096 pixels per side and 2 MiB, with a music-note fallback for unsupported or unavailable images.
Follow the host language setting for Japanese, English, and Simplified Chinese UI.
The MOD requires the updated host. Playback positions are not persisted across restarts. AAC/HLS and Radiko are not included.
