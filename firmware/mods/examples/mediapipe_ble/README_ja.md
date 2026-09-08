# MediaPipe BLEで顔と手を追従する

Web の MediaPipe デモが BLE Local Peer で送る顔向き、表情、左右の目・口の開き、手の位置・向き・指の本数を受信します。既存のワイヤー形式 v1〜v4 を維持しています。

## 操作と動作

MOD を起動し、Web の MediaPipe デモから `stackchan-mediapipe` へ BLE 接続します。顔向きは鏡像になるよう yaw を反転し、SDKの度へ変換して、機種の可動域へ制限します。笑顔は `happy`、真顔は `neutral`。左右の目と口、手首から指先への方向、指の本数を共通の UI 追跡操作へ渡します。

実サーボ指令は最大10Hz、移動時間120msです。処理中の姿勢は最新値へ置き換えます。送信側の最新状態の再送・追跡の非ACK形式も維持し、古い姿勢を滞留させません。追跡が1秒途絶えると表示をリセットし、トルクを解放します。

## 改造と復帰

ワイヤーの検証と変換は `tracking-message.ts`、最新値の保持と期限は `tracking-receiver.ts`、開始・購読・周期登録は `mod.ts` に分けています。周期を変える場合は送信側の頻度と失効時間も考慮します。

追従が止まったら Web 側のカメラと BLE 接続を確認します。新しいデータが届けば追従を再開します。未対応機種や無線開始失敗の場合は理由を表示し、設定後に再起動します。WASM に BLE が実装されたことを意味しません。

## ビルドと導入

このブランチの app API 2 / host API 7 が必要です。古い host / XSA は更新・再ビルドします。`firmware/` で依存関係とツールチェーンを準備して実行してください。

```sh
npm run mod:build -- mods/examples/mediapipe_ble/manifest.json
npm run mod -- mods/examples/mediapipe_ble/manifest.json
```

前者はビルド、後者は既定の CoreS3 への書き込みです。別機種は対応する `mod:stackchan_rt` / `mod:takao_core2_sg90` を使います。機種の宣言と利用できる機能を確認してください。[全例と共通の復帰手順](../README_ja.md)、[公開 SDK](../../../sdk/README_ja.md) に共通契約をまとめています。
