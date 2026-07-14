# WebRadio MOD

M5StackChan CoreS3で複数のMP3 WebRadio局を再生し、音符エフェクトを表示するサンプルMODです。

## 書き込み

CoreS3をWi-Fiへ接続できるようホストの設定を済ませてから、`firmware`ディレクトリで次を実行します。

```console
npm run mod:m5stackchan_cores3 -- ./mods/examples/web_radio/manifest.json
```

起動するとネットワーク接続を待ってGroove Saladの再生を開始します。Drawerの`ラジオ`から`ラジオ停止`、SomaFM 7局、Radio Paradiseを選択できます。接続中、バッファリング中、ストリーム停止からの再接続待ちにはAppBar左上のインジケータを表示します。再生中は音声処理の余裕を確保するため、顔の呼吸、瞬き、視線移動を一時停止します。

局は`mod.ts`の`STATIONS`にラベル名と直接MP3 URLを追加できます。SomaFM以外も同じ形式で選択肢にできます。

## 制約

- 既定局はModdable SDKのcontributed版SomaFMアプリと同じ `http://ice2.somafm.com/groovesalad-128-mp3` です。
- Radio Paradiseには公式の128kbps直接MP3ストリームを使用します。
- 44.1kHzの直接MP3ストリームだけを対象とします。
- プレイリスト、リダイレクト、AAC、Ogg、HLS、曲名表示には対応しません。
- TTS、tone、音声バッファ再生を開始するとラジオは停止し、自動再開しません。
