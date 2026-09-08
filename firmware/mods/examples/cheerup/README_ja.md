# BLE・WebSocketで応援する

`cheerup_ble_lite` と `cheerup_ws` を統合しました。姿勢・表情・応援の検出と5つの音声素材を共有します。

## 準備と操作

「応援の通信」で Bluetooth STK / WebSocket / 停止を選びます。Bluetooth は既存の STK 送信アプリを接続します。WebSocket は Wi-Fi を設定し、`mod.ts` の `SOCKET_URL` を使用するサーバーへ変更して再ビルドします。

送信データは `{ "yaw": 0, "pitch": 0, "emotion": "HAPPY", "hooray": false }`。通信上の角度は従来どおりラジアンです。SDK へ渡す直前に度へ変換し、半分ずつの平滑化と設定済み可動域への制限を行います。`hooray` が false から true へ変わると、同梱の5つの WAV から一つを再生します。

切断時と「停止」ではトルクを解放します。姿勢更新は100msごとで、古い姿勢をキューへ積み続けません。顔や動きだけを改造するときも、接続の生成と終了は SDK に任せます。

受信できない場合は送信側の接続状態・URL・メッセージ形式を確認し、一度「停止」にして再選択します。WASM には STK / WebSocket の実機通信経路がありません。

## ビルドと導入

このブランチの app API 2 / host API 7 が必要です。古い host / XSA は更新・再ビルドします。`firmware/` で依存関係とツールチェーンを準備して実行してください。

```sh
npm run mod:build -- mods/examples/cheerup/manifest.json
npm run mod -- mods/examples/cheerup/manifest.json
```

前者はビルド、後者は既定の CoreS3 への書き込みです。別機種は対応する `mod:stackchan_rt` / `mod:takao_core2_sg90` を使います。機種の宣言と利用できる機能を確認してください。[全例と共通の復帰手順](../README_ja.md)、[公開 SDK](../../../sdk/README_ja.md) に共通契約をまとめています。
