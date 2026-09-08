# 音声・HTTP・WebSocketで会話する

`ai_stackchan`、`ai_stackchan_api`、`chatgpt` を統合しました。マイク入力、HTTP API、既存の会話サーバーからの WebSocket 入力を同じ対話処理へ渡します。

## 準備と操作

本体の設定で Wi-Fi、`ai.token`（OpenAI API キー）、`ai.context`（会話の指示）と自由文を話せる `tts.type` / 接続情報を設定します。`ai.token` が未設定なら起動時に `CONFIG` を表示します。設定を保存して、この MOD を起動し直してください。素材だけを再生する TTS では会話文を読み上げられません。

主ボタンまたは「話しかける」で、開始音 → 録音 → 終了音 → Whisper 文字起こし → Responses API の対話 → 読み上げを行います。「挨拶から会話」は録音を省略し、「音声合成を試す」は TTS の設定を確認します。「周りを見る」は注視を切り替えます。対話中の別入力は `BUSY` になります。

「外部から話しかける」で HTTP / WebSocket / 停止を選びます。切り替え時には前の接続を閉じます。HTTP はポート8080で、従来と同じフォーム名を使います。

| リクエスト | フォーム | 結果 |
| --- | --- | --- |
| `POST /speech` | `say=こんにちは` | 自由文を読み上げる |
| `POST /chat` | `text=こんにちは` | 会話して読み上げ、返事を返す |
| `POST /face` | `expression=1` | 表情を変更する |

`expression` は0から順に neutral / happy / sleepy / doubt / sad / angry / cold / hot。旧 API の未実装だった設定・キー・ロール用ルートは引き続き501です。設定変更には本体の共通設定を使ってください。

WebSocket は `ws://<tts.host>:8080` へ接続します。受信は `{"role":"user","message":"こんにちは"}`、返信は `{"role":"assistant","message":"返事"}`。句点などで分けた文を返信・読み上げます。サーバー側も起動してください。

## 改造と復帰

会話モデルは `chat.dialogue({ model: '…', tools: [tool] })` の指定箇所、入力方法はメニューの `input`、追加の道具は `Tool` を編集します。トークンはソースに書かず設定へ保存します。通信や読み上げが失敗したら設定を確認して再操作します。外部入力の接続は一度「停止・マイクだけ」に戻して再接続できます。

## ビルドと導入

このブランチの app API 2 / host API 10 が必要です。古い host / XSA は更新・再ビルドします。`firmware/` で依存関係とツールチェーンを準備して実行してください。

```sh
npm run mod:build -- mods/examples/conversation/manifest.json
npm run mod -- mods/examples/conversation/manifest.json
```

前者はビルド、後者は既定の CoreS3 への書き込みです。別機種は対応する `mod:stackchan_rt` / `mod:takao_core2_sg90` を使います。機種の宣言と利用できる機能を確認してください。[全例と共通の復帰手順](../README_ja.md)、[公開 SDK](../../../sdk/README_ja.md) に共通契約をまとめています。

Claude / Gemini、初期メッセージ、履歴、MCP ツールの使い方は [プロバイダー移行](../provider-dialogues/README_ja.md) を参照してください。録音からの文字起こしは OpenAI の操作なので、対話を別サービスへ変える場合も、そのサービスのキーを文字起こしへ渡さないでください。
