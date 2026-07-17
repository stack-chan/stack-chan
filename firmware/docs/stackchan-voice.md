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
`await robot.audio.say(...)`, so the same block runs this engine on both
targets.

## Singing

`stackchan-voice` can pin each mora to an equal-tempered note and an exact
duration. The public audio capability accepts the engine's raw `koe` notation:

```js
await robot.audio.sing(
  '#C4,450ki#C4,450ra#G4,450ki#G4,450ra' +
    '#A4,450hi#A4,450ka#G4,900ru#R,150',
)
```

`#C4,450ki` sings the mora `ki` at C4 for 450 milliseconds. `+` and `-`
select sharps and flats, and `#R,150` inserts a 150 millisecond rest. Notes
hold a stable pitch with a short portamento; notes longer than roughly 350 ms
also receive a delayed vibrato. One note consumes one mora.

Singing is optional on the active TTS provider. `robot.audio.sing(...)`
returns a failed result instead of silently speaking the notation when the
current provider does not implement singing.

The block editor hides the raw notation. Its 「テンポ … で歌う」 block contains
typed note and rest blocks. Each note takes a pitch, a beat count, and one kana
mora. The generator converts the score to exact milliseconds and romanized
`koe`, so CoreS3 and the browser simulator play the same score without doing
text-to-koe conversion at playback time.
