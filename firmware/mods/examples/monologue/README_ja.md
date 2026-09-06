# ぽしょぽしょ独り言ｽﾀｯｸﾁｬﾝ

ｽﾀｯｸﾁｬﾝが独り言を喋るデモです。主ボタン（画面の「実行」または本体の主入力）を押すと設定した音声をランダムに発話します。SDK世代2のホストを使ってください。再生中の連打は追加実行しません。
自由文の音声合成と、事前生成した音声素材の再生を使えます。利用可能な能力に応じて `app.audio.say(text)` または `app.audio.playClip(name)` を使います。ホスト内部の設定を読んで `say` の引数の意味を切り替える必要はありません。

TTS についての詳細は[TTS（音声合成）の使用](../../../docs/text-to-speech_ja.md)を参照してください。

## 事前生成

* 本体の音声設定で素材再生用の `local` を選びます。
* `assets`ディレクトリに生成した音声素材を格納します。素材はこの例には同梱していません。[生成手順](../../../scripts/README_ja.md)に従い、`speeches_monologue.js` を入力として生成してください。
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

* 本体の音声設定で、自由文を合成できるプロバイダーと必要な接続情報を設定します。設定を反映した後にアプリを起動します。
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

`npm run mod -- mods/examples/monologue/manifest.json` で宣言と素材を含むアプリを書き込みます。音声を変更する場合は主に `speeches_monologue.js` を編集します。素材再生では対応するファイルの再生成も必要です。

自由文の合成と素材再生の両方が使えない場合は、設定確認の案内を顔の上に表示します。アプリの終了時には入力購読と実行中の音声操作をホストが終了します。
