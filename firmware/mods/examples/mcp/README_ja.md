# MCPから表情と発話を操作する

既存の MCP サーバーを公開 SDK の道具として登録します。ホストの画面や TTS を直接参照しません。

## 準備と操作

本体の Wi-Fi、自由文を話せる TTS、必要に応じて `mcp.token` を設定します。起動すると `http://<本体のIP>:8080/mcp` を吹き出しに表示します。「MCP アドレス」で再表示できます。MCP クライアントをこのエンドポイントへ接続します。

`set_emotion` は SDK の neutral / angry / sad / happy / sleepy / doubt / cold / hot、`say_message` は `message` を受け取ります。既存クライアントの大文字表情名と `DOUBTFUL` も通信入力で正規化します。認証はホストの共通 MCP サーバーと `mcp.token` を使います。

## 改造と復帰

新しい道具は `tools` 配列へ入力スキーマと `execute(input, task)` を加えます。長い操作には `task.signal` を渡します。返事は実行完了後に返します。

Wi-Fi 接続やポートの確保に失敗した場合は設定と他の8080番サーバーを確認して MOD を起動し直します。読み上げ不能なら TTS の設定を確認します。アプリを終了するとサーバーと実行中の道具を停止します。

## ビルドと導入

このブランチの app API 2 / host API 7 が必要です。古い host / XSA は更新・再ビルドします。`firmware/` で依存関係とツールチェーンを準備して実行してください。

```sh
npm run mod:build -- mods/examples/mcp/manifest.json
npm run mod -- mods/examples/mcp/manifest.json
```

前者はビルド、後者は既定の CoreS3 への書き込みです。別機種は対応する `mod:stackchan_rt` / `mod:takao_core2_sg90` を使います。機種の宣言と利用できる機能を確認してください。[全例と共通の復帰手順](../README_ja.md)、[公開 SDK](../../../sdk/README_ja.md) に共通契約をまとめています。
