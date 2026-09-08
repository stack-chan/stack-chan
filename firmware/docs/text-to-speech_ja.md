# TTS（音声合成）と音声素材

[English](./text-to-speech.md)

アプリは `stackchan` の `app.audio` を使います。文章の合成は `say(text)`、同梱した音声素材の再生は `playClip(name)` に分かれています。機能の確認・キャンセル・エラー処理は [SDK ガイド](../sdk/README_ja.md) を参照してください。

| 用途 | API | 準備 |
| --- | --- | --- |
| その場で日本語を合成 | `app.audio.say(text)` | `tts.type=stackchan-voice`。ネットワーク不要 |
| サーバーで文章を合成 | `app.audio.say(text)` | 対応provider、接続先と認証情報、ネットワーク |
| 事前に生成した音声を再生 | `app.audio.playClip(name)` | WAVをMODの `resources` に同梱 |

## 文章を話す

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

設定画面で音声providerを選択します。`stackchan-voice` は同梱のオフライン日本語エンジンです。リモートproviderには `remote`（Coqui互換）、`voicevox`、`voicevox-web`、`elevenlabs`、`openai` があります。接続先やAPIキーはホスト設定で管理し、配布するソースやmetadataへ秘密を入れないでください。設定は [設定スキーマ](../sdk/settings-schema.ts)、オフライン合成と歌は [stackchan-voice](./stackchan-voice.md) を参照してください。

`audio.speech` が利用不可なら、`app.capabilities.get('audio.speech')` の理由を表示できます。プロバイダー設定・通信・再生の失敗はPromiseの拒否になります。入力handler内の非同期処理は `await` または `return` し、ホストに完了と失敗を渡します。

## 音声素材を用意する

MODのフォルダーに、素材名と文章の対応を作ります。

```js
// speeches.js
export const speeches = {
  hello: 'こんにちは、ｽﾀｯｸﾁｬﾝです。',
  goodbye: 'また遊ぼうね。',
}
```

音声生成スクリプトは開発PCからサーバーへ接続してWAVを保存します。次はVoiceVoxエンジンをローカルで起動した場合の例です。`firmware/` で実行し、出力先の `assets` ディレクトリーを先に作成してください。

```sh
npm run generate-speech-voicevox -- \
  --input mods/my-app/speeches.js --output mods/my-app/assets \
  --host 127.0.0.1 --port 50021 --speaker 1 --sample 11025
```

Coqui用は `generate-speech-coqui`（`--host` / `--port`）、Google Cloud用は `generate-speech-google`（認証ファイル `scripts/key.json`）です。いずれも `--input` / `--output` を指定できます。サーバーや認証情報の取得は各サービスの手順に従ってください。

教材のmanifestへ次の項目を追加します。

```json
{
  "resources": { "*": "./assets/*" }
}
```

```js
await app.audio.playClip('hello', { signal: task.signal })
```

`hello.wav` はビルド時にMAUDへ変換されます。ホストは素材のヘッダーから再生レートを取得するため、アプリ側の `tts.sampleRate` 指定は不要です。欠落・不正な素材は再生前に拒否します。現在のWASM版は音声素材の再生に未対応なので、`audio.clips` を確認してください。

`stackchan-mod.json` はschema 2 / app API 2を宣言し、必要な機能に `audio.speech` または `audio.clips` を追加します。音声素材のレートを自動判定するホストはAPI 9以降です。既存の素材例は [beacon](../mods/examples/beacon/README_ja.md) にあります。
