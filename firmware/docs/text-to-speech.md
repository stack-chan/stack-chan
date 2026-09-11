# Speech synthesis and audio clips

[日本語](./text-to-speech_ja.md)

Apps use `app.audio` from the `stackchan` SDK. `say(text)` synthesizes natural language; `playClip(name)` plays a bundled resource. See the [SDK guide](../sdk/README_ja.md) for capabilities, cancellation and errors.

| Purpose | API | Requirements |
| --- | --- | --- |
| Offline Japanese speech | `app.audio.say(text)` | The bundled `stackchan-voice` provider |
| Server-generated speech | `app.audio.say(text)` | A configured provider, credentials and network |
| Prerecorded speech | `app.audio.playClip(name)` | WAV files included as MOD resources |

## Speaking text

```js
import { defineApp } from 'stackchan'

export default defineApp({
  setup(app) {
    app.input.onPress('primary', async (task) => {
      await app.audio.say('こんにちは、ｽﾀｯｸﾁｬﾝです。', { signal: task.signal })
    })
  },
})
```

Choose the provider in host settings. `stackchan-voice` synthesizes Japanese offline. Remote providers are `remote` (Coqui-compatible), `voicevox`, `voicevox-web`, `elevenlabs` and `openai`. Keep credentials in host settings. The [settings schema](../contracts/settings-schema.js) defines the supported fields; [stackchan-voice](./stackchan-voice.md) describes the offline engine and singing.

Check `app.capabilities.get('audio.speech')` for availability and a reason when unavailable. Configuration, network and playback failures reject the operation. Await or return asynchronous work inside input handlers so the host can track its completion and failure.

## Preparing clips

Create a text dictionary in the MOD directory:

```js
// speeches.js
export const speeches = {
  hello: 'Hello, I am Stack-chan.',
  goodbye: 'See you later.',
}
```

The development scripts request speech from a server and save WAV files. With a local VoiceVox engine running, create the output directory and run from `firmware/`:

```sh
npm run generate-speech-voicevox -- \
  --input mods/my-app/speeches.js --output mods/my-app/assets \
  --host 127.0.0.1 --port 50021 --speaker 1 --sample 11025
```

The corresponding scripts are `generate-speech-coqui` (`--host` / `--port`) and `generate-speech-google` (credentials in `scripts/key.json`). Both accept `--input` / `--output`. Follow the service's own setup and authentication instructions.

Add this field to the lesson's manifest:

```json
{
  "resources": { "*": "./assets/*" }
}
```

```js
await app.audio.playClip('hello', { signal: task.signal })
```

The build converts `hello.wav` into MAUD. Host API 9 reads the playback rate from that resource's header; an app-level `tts.sampleRate` override is unnecessary. Missing or malformed clips reject before playback. Clips are currently unavailable on WASM; check `audio.clips` before using them there.

Declare schema 2 / app API 2 and `audio.speech` or `audio.clips` in `stackchan-mod.json`. Require host API 9 for header-derived clip rates. See [beacon](../mods/examples/beacon/README_ja.md) for an existing resource example.
