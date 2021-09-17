# Using Text To Speech(TTS)

Currently there are two way to use TTS.

* __Pregenerated__: Generates and flash speeches at buildtime and plays standalone. Suitable for predefined statements.
* __Remote__: Queries speech statements to the TTS server, then streams the voice generated.

__Local(On demand)__ TTS such as aquestalk is not available for now pull requests are welcome!

## Prerequisites

No matter which way you choose, you should prepare an extrenal TTS engine first.

Tested below:

* [Google Cloud Text-to-Speech API](https://cloud.google.com/text-to-speech)
* [Coqui AI TTS](https://github.com/coqui-ai/TTS)

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

* save server configuration under `stackchan/manifest_local.json`

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

## Usage(Pregenerated)

* write down sentenses to speech in `stackchan/assets/sounds/speeches_[lang].js

```javascript
const speeches = {
  niceToMeetYou: 'Hello. I am Stach-chan. Nice to meet you.',
  hello: 'Hello World.',
  konnichiwa: 'Konnichiwa.',
  nihao: 'Nee hao.',
}
export default {
  shift: 2.0,
  speeches,
}
```

* Run `npm run generate-speech-[google|coqui]`
  * this script get voice data from server and saves wave files under `stackchan/assets/sounds`
* Flash firmware with assets
* Call `Robot#speak(sentense: string)` with the sentense. It's reasonable to use predefined sentense of `speeches`

```javascript
import { speeches } from 'speeches'
// ...
robot.speak(speeches.niceToMeetYou)
```

## Usage(Remote)

* Set config `tts.driver` to `remote` in `manifest_local.json`

```json
{
    "config": {
        "tts": {
            "driver": "remote",
            "host": "your.tts.host.local",
            "port": 8080
        }
    }
}
```

* Call `Robot#speak(sentense: string)`

```javascript
import { speeches } from 'speeches'
// ...
robot.speak('Now I can speak any sentense you want.')
```
