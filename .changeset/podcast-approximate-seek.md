---
'stack-chan': patch
---

Reduce long forward-seek waits in Podcast by requesting a nearby byte range for observed constant-bitrate MP3 candidates. Mark approximate positions separately from estimated duration, retain exact seeking as the media API default, and fall back to frame scanning when the fast path cannot be used.
