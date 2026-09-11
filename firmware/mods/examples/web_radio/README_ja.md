# ネットラジオを再生する

M5StackChan CoreS3 の MP3 再生機能を `streamingAudio(app).radio()` から利用します。

## 操作

Wi-Fi を設定して起動すると Groove Salad を音量0.2で再生します。「ラジオ局」で8局（Groove Salad、Drone Zone、Deep Space One、Space Station、Secret Agent、Beat Blender、Indie Pop、Radio Paradise）と「停止」を選べます。旧例の URL と局名を保持しています。

局変更は前の再生を停止してから開始します。接続・バッファ待ち・再試行・エラーを表示し、再生中は音符を表示します。途切れた場合はプレイヤーの再接続を使います。再生中はスピーカーを占有するため、発話や tone は `BUSY` になります。

## 改造と復帰

局の一覧は `stations`、URLと初期音量は `select` を変更します。MP3 に対応した配信を指定します。Piu controller や生のプレイヤーへの参照は不要です。

接続できない場合は Wi-Fi と配信 URL を確認し、「停止」から選び直します。起動時に失敗した場合は MOD を起動し直します。配信サービスの継続提供はこのコードで保証しません。Core2 / Stackchan RT / WASM は現在このプレイヤーを持たず、成功には扱いません。

## ビルドと導入

このブランチの app API 2 / host API 7 が必要です。古い host / XSA は更新・再ビルドします。`firmware/` で依存関係とツールチェーンを準備して実行してください。

```sh
npm run mod:build -- mods/examples/web_radio/manifest.json
npm run mod -- mods/examples/web_radio/manifest.json
```

前者はビルド、後者は既定の CoreS3 への書き込みです。別機種は対応する `mod:stackchan_rt` / `mod:takao_core2_sg90` を使います。機種の宣言と利用できる機能を確認してください。[全例と共通の復帰手順](../README_ja.md)、[公開 SDK](../../../sdk/README_ja.md) に共通契約をまとめています。
