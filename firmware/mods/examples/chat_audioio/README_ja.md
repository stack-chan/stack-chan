# リアルタイム音声会話

5種類の会話サービスを `conversation(app).realtime()` から利用します。旧 MOD 専用の設定読み込みと AudioIO の直接生成を共通サービスへ移しました。

## 準備と操作

Wi-Fi と本体設定の「リアルタイム会話」を設定します。キーは `chat.type`、`chat.apiKey`、`chat.endpoint`、`chat.modelID`、`chat.voiceID`、`chat.instructions` です。`chat.type` は `openAIRealtime` / `googleGeminiLive` / `deepgramAgent` / `elevenLabsAgent` / `humeAIEVI`。選んだサービスに合うキー・モデル・音声を使ってください。旧 `config.js` の値は自動移行しないため、保存設定へ転記します。

「リアルタイム会話」をオンにするとマイクとスピーカーを確保して接続します。状態、直近80文字の文字起こし、出力音量に応じた口の動きを表示します。「周りを見る」は首の注視を切り替えます。会話中は別の録音・音声再生が `BUSY` になります。

失敗・切断時はスイッチがオフになります。設定や通信を確認してオンにすると再接続します。停止は同じスイッチをオフにします。機種に選択したプロトコルや音声入出力がなければ `UNSUPPORTED` で終了します。対応機種の宣言はクラウド側の利用資格や接続成功を保証しません。

## 改造

表示更新は300ms、口の更新は125msにまとめています。道具の追加は `tools`、初期音量は `volume` を変更します。AudioIO の生成・終了をアプリへコピーする必要はありません。

## ビルドと導入

このブランチの app API 2 / host API 7 が必要です。古い host / XSA は更新・再ビルドします。`firmware/` で依存関係とツールチェーンを準備して実行してください。

```sh
npm run mod:build -- mods/examples/chat_audioio/manifest.json
npm run mod -- mods/examples/chat_audioio/manifest.json
```

前者はビルド、後者は既定の CoreS3 への書き込みです。別機種は対応する `mod:stackchan_rt` / `mod:takao_core2_sg90` を使います。機種の宣言と利用できる機能を確認してください。[全例と共通の復帰手順](../README_ja.md)、[公開 SDK](../../../sdk/README_ja.md) に共通契約をまとめています。
