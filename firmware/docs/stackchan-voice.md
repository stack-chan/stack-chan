# stackchan-voice TTS

`stackchan-voice` is an offline Japanese TTS engine bundled with the device
firmware and the WASM simulator. It synthesizes 8 kHz PCM and converts it to the
24 kHz mono output used by Stack-chan. On CoreS3, standalone speech and singing
acquire the shared speaker without opening the microphone. The mouth follows the
power of the PCM consumed by the output driver. The WASM simulator plays
standalone utterances through its browser Audio bridge.

To use the same engine in a cascaded conversation, import
`createStackchanVoiceTTS` from `stackchan/voice/stackchan-voice` and pass its
result as the conversation's `tts`. Choose `normal` or `cute` as the voice, or
`default` to use the factory preset. Each synthesis session accepts one
utterance and exposes 24 kHz, 16-bit mono PCM through `output`. Connect the
output before calling `finish()`. Standalone MODs can use `audio.say(text)`
and `audio.sing(koe)`, both of which wait for speaker playback to finish.
CoreS3 MODs that called the local player's `stream()` or `streamKoe()`
directly should call `audio.say()` or `audio.sing()` and await the result.

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

Singing is optional on a `SpeechPlayback` provider. `robot.audio.sing(...)` returns a failed result if the configured player cannot sing.

The block editor hides the raw notation. Its 「テンポ … で…を歌う」 block takes
one score list and one global BPM. Every list item has the same
`[pitch, beats, lyric]` triple shape; a rest uses `['R', beats, '']`. The
generated helper validates the list, converts beat counts to exact
milliseconds, romanizes each one-kana-mora lyric, and calls
`robot.audio.sing(...)`. CoreS3 and the browser simulator therefore play the
same score without doing text-to-koe conversion inside the voice provider.

## Offline sanoTTS-jp on CoreS3

Install the optional CoreS3 host and its separately licensed model using the [installation guide](./sanotts_ja.md). Set the string preference `tts.type` to `sanotts` and restart. This selects sanoTTS for `context.audio.say()` and the speech output stage of the `ai_stackchan` MOD. In that MOD the STT and LLM still use OpenAI. With any other setting, the MOD retains its OpenAI speech output. To resume standalone StackchanVoice speech and singing, select `stackchan-voice`. The sanoTTS voice supports speech only.

For a custom cascaded conversation, pass `createSanoTTS()` from `stackchan/voice/sanotts` as its `tts` and use `voice: 'default'`. The provider's `open()` converts ordinary text using the local reading dictionary. Its `openKana()` accepts sanoTTS intermediate kana and accent markers directly. Both sessions expose mono 24 kHz signed 16-bit PCM and accept the same cancellation signal. The built-in reading dictionary rejects an unknown kanji compound. Use `openKana()` to specify its pronunciation, or pass a synchronous `toKana(text)` function to `createSanoTTS({ toKana })` to supply domain-specific readings. One utterance accepts up to 512 UTF-8 bytes of intermediate kana and 350 encoded IDs. Split longer text at a sentence boundary before submitting it. Missing or incompatible models, unsupported input and memory exhaustion fail the utterance and release the speaker. The provider makes no cloud retry.

The native inference task runs on the opposite core from XS on dual-core ESP32-S3. A 32 KiB PSRAM ring holds unplayed samples. Its producer waits for space before the next inference pull. An utterance starts feeding the speaker once 12,288 samples are available (512 ms of audio) or synthesis has finished. A reusable 2 KiB buffer passes PCM to the shared speaker with backpressure. Cancellation requests worker shutdown, then waits for the worker to leave its current inference call before releasing memory. For local verification with the installed model, run `bash scripts/test-sanotts-native.sh` from `firmware/` on Linux.
