# stackchan-voice TTS

`stackchan-voice` is an offline Japanese TTS engine bundled with the device
firmware and the WASM simulator. It synthesizes 8 kHz PCM and converts it to the
24 kHz mono output used by Stack-chan. Device firmware streams that PCM to
AudioOut. The WASM simulator renders the same vendored engine into a WAV buffer
and plays it through the browser Audio bridge. Playback power is forwarded
through the standard `TTS.onPlayed` callback, so the existing runtime mouth
animation works without a conversation-module-specific integration.

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

`voice` accepts `normal` or `cute`. Both supported targets default to `normal`
and speed `100`. CoreS3 uses volume `0.1`; the browser simulator uses `0.5`.

The firmware repository contains a reproducible snapshot under
`vendor/stackchan-voice`. Refresh it from a local checkout with:

```sh
node scripts/vendor-stackchan-voice.mjs \
  --source /path/to/stackchan-voice \
  --revision <git-revision> [--dirty]
```

The script verifies the dictionary digest from its source metadata and writes
SHA-256 hashes for every copied file to `VENDOR_SOURCE.json`.

The M5StackChan CoreS3 firmware and WASM simulator select `stackchan-voice` by
default. The block editor's 「おしゃべり」 block generates
`await app.audio.say(..., { signal: task.signal })`, so the same block runs this engine on both
targets.

## Singing

The SDK audio extension accepts a BPM and a list of `[pitch, beats, lyric]`
tuples. A rest is `['R', beats, '']`; one note consumes one kana mora.

```js
import { singing } from 'stackchan/extensions/audio'

// Inside an app task or input handler:
await singing(app).sing(120, [
  ['C4', 1, 'き'], ['C4', 1, 'ら'],
  ['G4', 1, 'き'], ['G4', 1, 'ら'], ['R', 0.5, ''],
], { signal: task.signal })
```

Declare `audio.singing` and host API 8 or later. The shared host compiler
validates the score, converts beat counts to milliseconds and romanizes lyrics.
Blockly generates the same SDK call. Apps do not embed a second compiler or
call the provider's internal `koe` notation.

The engine holds a stable pitch with a short portamento and adds delayed
vibrato to longer notes. Providers without singing reject with
`StackchanError.code === 'UNSUPPORTED'`. Cancellation and app shutdown release
the shared audio output before completing.
