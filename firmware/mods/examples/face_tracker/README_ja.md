# UnitV2の顔追跡

UnitV2 の連続 HTTP 応答を読み、最初の顔へ首を向けます。

## 準備と操作

UnitV2 と本体を同じネットワークへ接続し、UnitV2 の顔検出を起動します。接続先は `mod.ts` の `http://unitv2.local/func/result`。応答の `face[0].x / y / w / h` と640×480の画像座標を使います。

起動時に追跡を開始します。「UnitV2 の顔を追う」をオフにすると接続と注視を止めます。通信上の結果は `|` 区切りで、TCPの分割や日本語の複数バイト境界をまたいでも1件ずつ解釈します。1結果は最大16,384 bytes、無受信5秒で停止します。首の目標はSDKの度へ変換し、機種の可動域へ制限します。

切断時は理由を表示してスイッチをオフにします。UnitV2 の検出・URL・Wi-Fiを確認し、オンにすると再接続します。画像サイズを変えた場合は `mod.ts` の座標変換も合わせて編集します。

プロトコルの参考：[UnitV2 サーバー実装の `/func/result`](https://github.com/syagawa/m5stack-unitv2-sample/blob/master/server_core.py)。UnitV2 の別ファームウェアで応答形式が違う場合は合わせて変更してください。実機との接続確認は未実施です。

## ビルドと導入

このブランチの app API 2 / host API 7 が必要です。古い host / XSA は更新・再ビルドします。`firmware/` で依存関係とツールチェーンを準備して実行してください。

```sh
npm run mod:build -- mods/examples/face_tracker/manifest.json
npm run mod -- mods/examples/face_tracker/manifest.json
```

前者はビルド、後者は既定の CoreS3 への書き込みです。別機種は対応する `mod:stackchan_rt` / `mod:takao_core2_sg90` を使います。機種の宣言と利用できる機能を確認してください。[全例と共通の復帰手順](../README_ja.md)、[公開 SDK](../../../sdk/README_ja.md) に共通契約をまとめています。
