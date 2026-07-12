# WebRadio MOD

M5StackChan CoreS3でSomaFM Groove Saladを再生し、リラックスした表情と音符エフェクトを表示するサンプルMODです。

## 書き込み

CoreS3をWi-Fiへ接続できるようホストの設定を済ませてから、`firmware`ディレクトリで次を実行します。

```console
npm run mod:m5stackchan_cores3 -- ./mods/examples/web_radio/manifest.json
```

起動するとネットワーク接続を待って再生を開始します。Drawerの`Radio`トグルで停止・再開できます。

## 制約

- 既定局は `https://ice2.somafm.com/groovesalad-128-mp3` です。
- 44.1kHzの直接MP3ストリームだけを対象とします。
- プレイリスト、リダイレクト、AAC、Ogg、HLS、曲名表示には対応しません。
- TTS、tone、音声バッファ再生を開始するとラジオは停止し、自動再開しません。
