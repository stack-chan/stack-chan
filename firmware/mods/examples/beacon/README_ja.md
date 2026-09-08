# BLEビーコンで挨拶する

`beacon_advertiser` と `beacon_scanner` を一つに統合しました。両方の端末に同じ MOD を入れ、メニューで役割を選びます。

## 操作

Wi-Fi は不要です。「ビーコン」で片方を「送信」、もう片方を「受信」にします。送信側の「こんにちは」「さようなら」で相手へ通知し、双方に挨拶を表示します。「停止」は無線接続を閉じます。

初期状態は「文字だけ」です。旧サンプルにも WAV 本体は同梱されていませんでした。「用意した WAV」を使うには、`speeches_greeting.js` の6つの名前に対応する音声を `assets` に用意して再ビルドします。VOICEVOX エンジンを手元で起動済みなら、`firmware/` から次の既存生成コマンドを使えます。

```sh
npm run generate-speech-voicevox -- --input mods/examples/beacon/speeches_greeting.js --output mods/examples/beacon/assets --host 127.0.0.1 --port 50021 --speaker 1 --sample 11000
```

「設定した音声合成」は本体で設定した自由文 TTS を使います。音声だけが失敗した場合も、先に送信したビーコンと文字表示は確認できます。

## 通信・改造・復帰

UUID `CFFD85BB-67E0-9CD4-B2D0-BE5A7ECAC915`、manufacturer ID `0x004c`、major は連番、minor は1=挨拶 / 2=別れ、という既存形式を維持します。受信側は連番の重複を省き、次の処理で最新の挨拶を使います。

挨拶の文は `speeches_greeting.js` を編集します。再生レートは素材のヘッダーから読み取るため、`config.js` は不要です。受信しない場合は双方の役割・UUIDを確認し、「停止」から選び直してください。WASM で BLE の成功を擬似表示する機能はありません。

## ビルドと導入

このブランチの app API 2 / host API 9 が必要です。古い host / XSA は更新・再ビルドします。`firmware/` で依存関係とツールチェーンを準備して実行してください。

```sh
npm run mod:build -- mods/examples/beacon/manifest.json
npm run mod -- mods/examples/beacon/manifest.json
```

前者はビルド、後者は既定の CoreS3 への書き込みです。別機種は対応する `mod:stackchan_rt` / `mod:takao_core2_sg90` を使います。機種の宣言と利用できる機能を確認してください。[全例と共通の復帰手順](../README_ja.md)、[公開 SDK](../../../sdk/README_ja.md) に共通契約をまとめています。
