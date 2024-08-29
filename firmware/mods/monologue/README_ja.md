# ぽしょぽしょ独り言ｽﾀｯｸﾁｬﾝ

ｽﾀｯｸﾁｬﾝが独り言を喋るデモです。A ボタンを押すと設定した音声をランダムに発話します。
TTS（音声合成）の使用は事前生成とリモートの２つの方法があります。

TTS についての詳細は[TTS（音声合成）の使用](../../docs/text-to-speech_ja.md)を参照してください。

## 事前生成

* `assets`ディレクトリに音声ファイルを格納します。
* `speeches_monologue.js`の変数`speeches`の key に格納した音声ファイル名を記載します。
  * 変数`speeches`のvalueは任意値でも問題ありません。

例）音声ファイル`niceToMeetYou`、`hello`、`konnichiwa`、`nihao`を格納した場合

```javascript
// speeches.js
export const speeches = {
  niceToMeetYou: 'Hello. I am Stach-chan. Nice to meet you.',
  hello: 'Hello World.',
  konnichiwa: 'Konnichiwa.',
  nihao: 'Nee hao.',
}
```

## リモート

* ホストファームウェアを書き込む時に `manifest_local.json`の`config.tts`を使用する TTS エンジンに合わせて設定します。
* `speeches_monologue.js`の変数`speeches`の value に発話する文章を記載します。
  * 変数`speeches`のkeyは任意値でも問題ありません。

例）`niceToMeetYou`、`hello`、`konnichiwa`、`nihao`を発話する場合

```javascript
// speeches.js
export const speeches = {
  sentense1: 'Hello. I am Stach-chan. Nice to meet you.',
  sentense2: 'Hello World.',
  sentense3: 'Konnichiwa.',
  sentense4: 'Nee hao.',
}
```
