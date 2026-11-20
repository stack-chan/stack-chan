# TTS（音声合成）の使用

[English](./text-to-speech.md)

`robot.audio.say(text)` で使う発話再生の設定を紹介します。

* __事前生成__：ビルド時に音声を生成し、スタンドアロンで再生します。事前に定義された文章に適しています。
* __リモート__：TTSサーバに音声文章を問い合わせ、生成された音声をストリームします。

CoreS3 と WASM シミュレーターでは、端末上で日本語の合成と歌唱もできます。[stackchan-voice の使い方](./stackchan-voice.md)

## 前提条件

事前生成とリモート再生には外部の音声合成エンジンを用意します。

以下がテスト済みです：

* [Google Cloud Text-to-Speech API](https://cloud.google.com/text-to-speech)
* [Coqui AI TTS](https://github.com/coqui-ai/TTS)
* [VoiceVox](https://github.com/Hiroshiba/voicevox_engine)
* [ElevenLabs](https://elevenlabs.io/speech-synthesis)

それぞれの公式ドキュメントも参照してください。

### Google Cloud TTS

* [認証ガイド](https://cloud.google.com/docs/authentication/getting-started)を通じて認証し、key.jsonを生成します。
* `key.json`を`scripts`ディレクトリに保存します。

### Coqui AI TTS

* coqui-ai/TTSをインストールします。
* サーバを起動します。

```sh
$ tts-server --port 8080 --model_name tts_models/ja/kokoro/tacotron2-DDC
```

* `host/app/manifest_local.json`の`config.tts.host|port`にサーバー設定を保存します

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

* [API KEY](https://docs.elevenlabs.io/authentication/01-xi-api-key)に従い、API KEYを取得します。
* `host/app/manifest_local.json`の`config.tts`にAPI KEYを保存します

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

## 使用方法（事前生成）

以下のようなJavaScriptファイルに発話する文章を書き込みます（`mods/examples/monologue/speeches_monologue.js`などを参照）。

```javascript
// speeches.js
export const speeches = {
  niceToMeetYou: 'Hello. I am Stach-chan. Nice to meet you.',
  hello: 'Hello World.',
  konnichiwa: 'Konnichiwa.',
  nihao: 'Nee hao.',
}
```

* npm run generate-speech-[google|coqui|voicevox]を実行します
  * このスクリプトはサーバーから音声データを取得し、host/modules/audio/assets/soundsにwaveファイルを保存します
* 音声ファイルとともにファームウェアを書き込みます
* `context.say(sentence: string)`を呼び出します

```javascript
import { speeches } from 'speeches'
const keys = Object.keys(speeches)

export async function onContextCreated(context) {
  await context.say('hello')
  await context.say(keys[0] /* 'niceToMeetYou' */)
}
```

## 使用方法（リモート）

* `manifest_local.json`の`config.tts.type`プロパティを使用するTTSエンジンに合わせて設定します。


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

* `context.say(sentence: string)`を呼び出します。

```javascript
// ...
export async function onContextCreated(context) {
  await context.say('Now I can speak any sentence you want.')
}
```
