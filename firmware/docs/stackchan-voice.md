# stackchan-voice TTS

`stackchan-voice` is an offline, streaming Japanese TTS engine bundled with the
device firmware. It synthesizes 8 kHz PCM incrementally and converts it to the
24 kHz mono output used by Stack-chan. Playback power is forwarded through the
standard `TTS.onPlayed` callback, so the existing runtime mouth animation works
without a conversation-module-specific integration.

Select it with these preferences:

```json
{
  "tts": {
    "type": "stackchan-voice",
    "voice": "normal",
    "speed": 100,
    "volume": 0.1
  }
}
```

`voice` accepts `normal` or `cute`. The defaults are `normal`, speed `100`, and
volume `0.1`.

The firmware repository contains a reproducible snapshot under
`vendor/stackchan-voice`. Refresh it from a local checkout with:

```sh
node scripts/vendor-stackchan-voice.mjs \
  --source /path/to/stackchan-voice \
  --revision <git-revision> [--dirty]
```

The script verifies the dictionary digest from its source metadata and writes
SHA-256 hashes for every copied file to `VENDOR_SOURCE.json`.
