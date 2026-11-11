# OpenAI GPT-Live WebRTC 会話 MOD

CoreS3の内蔵マイクとスピーカーでGPT-Liveと会話します。`createLiveConversation`が接続を管理し、`createConversationPipeline`が音声デバイスを予約します。録音と再生はCoreS3のWebRTC処理内で行います。このMODは既存の録音・再生リングとFIFOに合わせて128KiB、1000msのメディア予算を指定します。通信・コーデック・DMAを含む実測メモリ使用量は別途計測が必要です。

設定例のAPIキーは空です。自動接続しません。ドロワーの「OpenAI 会話」で開始／終了、「マイクミュート」でミュート／解除します。接続失敗後は同じ会話ボタンで新しいセッションを開始できます。課金セッション作成を自動再試行しません。

## 設定

`firmware/`で作業します。

```sh
cp mods/examples/openai_live_webrtc/manifest.local.example.json \
   mods/examples/openai_live_webrtc/manifest.local.json
```

自分のエディターで`manifest.local.json`の`config.openaiLive.apiKey`へ、GPT-Liveを利用できるOpenAIプロジェクトAPIキーを入力してください。このファイルはGit追跡外です。モデル・声・指示・音量は`config.openaiLive`の`model`・`backendModel`・`voice`・`instructions`・`volume`で上書きできます。既定音量は0.1です。計算などの推論はResponsesへ委譲し、既定のバックエンドモデルは`gpt-6-luna`です。音声モデルとは別に設定でき、Responsesの利用料金も発生します。

**端末に保存するAPIキーは抽出可能です。** キーを含むMOD・ビルド出力・バックアップを公開しないでください。`manifest.local.json`を強制追加しないでください。キー・SDP・文字起こし・提供元のエラー本文はログに出しません。個人用端末でこの制約を受け入れる場合の例であり、配布端末向けの資格情報発行方式ではありません。

## CPUビルド

無改修Moddable SDK **10.1.0**、対応するESP-IDF **6.1**、`esp-webrtc-solution`基準コミット **c8650846b512e6e1375e5f78c1c41619b8d645eb**を使用します。既存SDKのチェックアウトや版を変更せず、それぞれのパスを設定してください。Wi-Fiの登録は通常のホスト設定を使います。

```sh
export MODDABLE=/path/to/moddable-10.1.0
export PATH="$MODDABLE/build/bin/lin/release:$PATH"
export IDF_PATH=/path/to/esp-idf-6.1
. "$IDF_PATH/export.sh"
export ESP_WEBRTC_SOLUTION=/path/to/esp-webrtc-solution

npm ci
npm run build -- --mode=release

# 空キーの例をコンパイルするだけ。APIへの接続は行わない。
npm run mod:build -- --mode=release mods/examples/openai_live_webrtc/manifest.json
```

この MOD はホスト API 3 の音声ポートを使用します。M5StackChan CoreS3 の標準ホストに会話モジュールが含まれます。

キー入力後の自分用MODは最後の引数を`manifest.local.json`に置き換えてビルドします。出力先は通常どおり`firmware/dist/`です。`mod:build`は書込みをしません。キーを入れる前の空設定でビルドを確認することを勧めます。

## 端末への導入

ホスト書込みとMOD書込みはCPUビルドとは別です。必要な端末を接続し、ホストを入れ替えてよいことを確認してから実行してください。

```sh
npm run flash -- --mode=release
npm run mod -- --mode=release mods/examples/openai_live_webrtc/manifest.local.json
```

Wi-Fi接続後、ドロワーから会話を開始します。開始要求からOpenAIの課金が発生し得ます。話しかけて音声応答を確認し、ミュート／解除を試した後、会話ボタンで終了してください。終了中は新しい会話を開始しません。音声停止・ネイティブ解放後に利用権を返すため、終了に時間がかかる場合があります。

## 音声と解放

- 対応ホストでは接続開始から終了処理が完了するまで呼吸・視線・まばたきを停止し、終了・エラー時に再開します。会話中の口は再生音量に合わせて100ms間隔で更新し、終了時に閉じます。
- ホストの短いTTS・録音・トーン再生中は開始を拒否します。メディア／WebRadioは停止してから音声を取得し、会話中のホストAPIによる再生・録音を拒否します。
- 音声デバイスの使用権を取得したときにアンプを48kHzに設定してから、既存ConversationのネイティブOpus／I2S処理を開始します。終了後はSDKの24kHz基準へ戻します。音声フレームを処理する独自JS Workerはありません。
- 出力中はマイク入力を閉じる半二重方式です。
- 正常終了、開始失敗、接続切断、ミュート失敗のいずれも、Conversationのclose完了後に音声排他とWi-Fi低遅延利用権を解放します。再接続は明示的な手動操作です。
- 履歴保存・追加ツール・字幕UI・認証サーバーは実装していません。

## 検証

```sh
npm run test:openai-live
npm run test:unit
npm run format
npm run lint
```

CPUテストでは空キー、Wi-Fi待機中のキャンセル、開始終了の重複、ミュート、接続エラー、解放順序と再接続を検証します。実機試験では音声入出力、ミュート／解除、正常終了、音声利用権の解放を確認してください。CPUテストだけでは聴感品質や実機の遅延を保証しません。

### 旧ホストでの確認結果（2026-10-17）

統合ホストで30秒間の実API試験を行い、録音済みの質問音声に対する「123×456＝56088」の回答、ミュート／解除、正常終了、音声利用権の解放を確認しました。呼吸などは停止し、音声に応じた口の更新は33回、終了後は顔アニメーションが再開しました。サーボ電源はOFFです。

最終試験の再生アンダーランは7回、無音継続は最大150msでした。100ms周期のメインタイマーの実行間隔は最大797msで、描画遅延そのものは未計測です。接続・会話成立の確認と、音切れ・UI遅延の評価は分けています。統合構成は利用者による動作確認済みです。長時間運転と遅延の定量評価は引き続き確認が必要です。

一次資料: [OpenAI GPT-Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=live)、[GPT-Live終了処理](https://developers.openai.com/api/docs/guides/live-conversations)、[ホストConversation](../../../host/modules/realtime-conversation/README.md)。
