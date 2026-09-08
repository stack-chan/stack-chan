# USBでリモート音声会話する

M5StackChan CoreS3 の USB 会話と承認画面を `conversation(app).remote()` から利用します。PC側の USB 対応ソフトウェアと本体を接続してください。

## 操作と復帰

「USB 音声会話」で開始・停止を要求します。頭のタッチが使える機種では、前方向のスワイプで開始、後方向で停止もできます。USB の接続状態と会話状態は別々に表示します。

「要求を受け付けました: …」は要求IDの発行を示します。会話が開始・停止したという完了通知ではありません。実際の状態通知に従ってスイッチの表示を更新します。USB側の承認フローを維持し、未対応 transport を成功として扱いません。

初期の有効化に失敗してもメニューを残します。接続やPC側を確認して再操作すると有効化をやり直します。停止要求は既存のホスト側セッションに渡し、アプリ終了では会話と承認画面を無効化して音声の占有を解放します。

## 改造と導入

入力を追加する場合は `request()` を共通に使い、要求IDと観測した状態を混同しないでください。USB機器や会話セッションをアプリで直接生成する必要はありません。

app API 2 / host API 7 の本体を用意し、`firmware/` で実行します。

```sh
npm run mod:build -- mods/examples/codex_voice/manifest.json
npm run mod -- mods/examples/codex_voice/manifest.json
```

対応 target は M5StackChan CoreS3。実機USB音声の受入は未実施です。[全例と共通の復帰手順](../README_ja.md)、[SDK](../../../sdk/README_ja.md) を参照してください。
