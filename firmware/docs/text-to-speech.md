# Using Text To Speech(TTS)

[日本語](./text-to-speech_ja.md)

These instructions configure the standalone speech player used by `robot.audio.say(text)`.

* __Pregenerated__: Generates and flash speeches at buildtime and plays standalone. Suitable for predefined statements.
* __Remote__: Queries speech statements to the TTS server, then streams the voice generated.

CoreS3 and the WASM simulator also support on-device Japanese synthesis and singing. See [stackchan-voice](./stackchan-voice.md).

## Prerequisites

For pregenerated and remote speech, configure an external speech engine.

Tested below:

* [Google Cloud Text-to-Speech API](https://cloud.google.com/text-to-speech)
* [Coqui AI TTS](https://github.com/coqui-ai/TTS)
* [VoiceVox](https://github.com/Hiroshiba/voicevox_engine)
* [ElevenLabs](https://elevenlabs.io/speech-synthesis)

See also official documents of each of them.

### Google Cloud TTS

* Get through [this authentication guide](https://cloud.google.com/docs/authentication/getting-started) and generate key.json
* Save `key.json` under `scripts` directory

### Coqui AI TTS

* Install coqui-ai/TTS
* Launch server

```sh
$ tts-server --port 8080 --model_name tts_models/ja/kokoro/tacotron2-DDC
```

* save server configuration under `config.tts.host|port` of `host/app/manifest_local.json`

```json
{
    "config": {
        "tts": {
            "host": "your.tts.host.local",
            "port": 8080
        }
    }
}
```

### ElevenLabs TTS
* Get through [API KEY](https://docs.elevenlabs.io/authentication/01-xi-api-key) and get API KEY.
* Set API KEY to `config.tts` of `host/app/manifest_local.json`.
```json
{
    "config": {
        "tts": {
            "type": "elevenlabs",
            "token": "YOUR_API_KEY"
        },
    }
}
```

## Usage(Pregenerated)

* write down sentenses to speech in the format below (See `mods/examples/monologue/speeches_monologue.js` and other examples)

```javascript
// speeches.js
export const speeches = {
  niceToMeetYou: 'Hello. I am Stach-chan. Nice to meet you.',
  hello: 'Hello World.',
  konnichiwa: 'Konnichiwa.',
  nihao: 'Nee hao.',
}
```

* Run `npm run generate-speech-[google|coqui|voicevox]`
  * this script get voice data from server and saves wave files under `host/modules/audio/assets/sounds`
* Flash firmware with assets
* Call `context.say(sentence: string)` with the sentence.

```javascript
import { speeches } from 'speeches'
const keys = Object.keys(speeches)

export async function onContextCreated(context) {
  await context.say('hello')
  await context.say(keys[0] /* 'niceToMeetYou' */)
}
```

## Usage(Remote)

* Set `config.tts.type` according to your TTS server in `manifest_local.json`

```json
{
    "config": {
        "tts": {
            "type": "remote",
            "host": "your.tts.host.local",
            "port": 8080
        }
    }
}
```

* Call `context.say(sentence: string)`

```javascript
// ...
export async function onContextCreated(context) {
  await context.say('Now I can speak any sentence you want.')
}
```
