# Local Peerで挨拶を送受信する

インターネットやアクセスポイントを使わず、近くの端末へテキストを送る例です。同じ MOD を2台へ入れます。

## 操作

「近くのスタックチャン」で片方を「受信」、もう片方を「送信」にします。送信側は3秒ごとに1秒間の探索を行い、`こんにちは 1`、`こんにちは 2`…を確認付きで送信します。受信側は吹き出しに表示します。「停止」はタイマーと通信を閉じます。役割変更は前の通信を閉じてから実行します。

オフラインで使う場合は両方の Wi-Fi 設定で「オフライン」を選びます。Wi-Fi 接続中は同じアクセスポイントを使います。既存の service `tech.stackchan.examples.hello`、メッセージ型 `text`、`payload.text` を維持し、送受信名は `stackchan-sender` / `stackchan-receiver` です。

表示前に64 Unicodeコードポイントへ切り詰め、制御文字と双方向表示制御文字を空白へ置換します。文字列でない値や空白だけの入力は表示しません。

## 改造と復帰

送信文と周期は `mod.ts`、表示の制限は `message-text.ts` を編集します。相手が見つからなくても次の周期で再探索します。開始処理中は同じ選択を重ねて実行しません。失敗したら「停止」へ戻し、相手の役割と無線環境を確認して再選択します。

## ビルドと導入

このブランチの app API 2 / host API 7 が必要です。古い host / XSA は更新・再ビルドします。`firmware/` で依存関係とツールチェーンを準備して実行してください。

```sh
npm run mod:build -- mods/examples/local_peer_hello/manifest.json
npm run mod -- mods/examples/local_peer_hello/manifest.json
```

前者はビルド、後者は既定の CoreS3 への書き込みです。別機種は対応する `mod:stackchan_rt` / `mod:takao_core2_sg90` を使います。機種の宣言と利用できる機能を確認してください。[全例と共通の復帰手順](../README_ja.md)、[公開 SDK](../../../sdk/README_ja.md) に共通契約をまとめています。
