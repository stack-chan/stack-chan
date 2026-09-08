# SDKの実行例

最初のプログラムは [7つの教材](../../lessons/README_ja.md) から始めます。このディレクトリーの実行可能な21パッケージは、すべて公開 SDK の app API 2 を使います。旧32例を移行・統合した対応表は [移行台帳](../../../docs/architecture/legacy-mod-migration.md) にあります。名前だけ残した旧ディレクトリーの README は移行先への案内です。

## 例を選ぶ

| 例 | 学べること | 条件 |
| --- | --- | --- |
| [look_around](look_around/README_ja.md) | 主入力、度・msによる首振り | motion |
| [monologue](monologue/README_ja.md) | 自由文と素材音声の区別 | 対応する TTS |
| [face](face/README_ja.md) | 表情、色、翻訳メニュー | 共通 UI |
| [image_avatar_lite](image_avatar_lite/README_ja.md) | 画像パックによる顔 | 共通 UI、同梱画像 |
| [board_diagnostics](board_diagnostics/README_ja.md) | ボードの入力・LED・motionの診断 | 使用できる機器を表示 |
| [stackchan_minigames](stackchan_minigames/README_ja.md) | JUMP / CATCH の Piu 画面 | Piu 拡張 |
| [mini_app_ui_sample](mini_app_ui_sample/README_ja.md) | 独自画面と終了時の処理 | Piu 拡張 |
| [conversation](conversation/README_ja.md) | 録音、文字起こし、対話、HTTP / WebSocket | Wi-Fi、APIキー、TTS |
| [chat_audioio](chat_audioio/README_ja.md) | リアルタイム音声会話 | Wi-Fi、対応プロバイダー、音声入出力 |
| [codex_voice](codex_voice/README_ja.md) | USB会話の要求と観測した状態 | CoreS3、PC側USB接続 |
| [mcp](mcp/README_ja.md) | 型付きの道具として表情と発話を公開 | Wi-Fi、TTS |
| [beacon](beacon/README_ja.md) | BLE広告と受信を同じアプリで切り替える | BLE、初期値は文字だけ |
| [cheerup](cheerup/README_ja.md) | STK / WebSocketの姿勢と応援音声 | 対応無線、motion、同梱WAV |
| [local_peer_hello](local_peer_hello/README_ja.md) | 発見、送信、受信、停止 | 対応するLocal Peer無線 |
| [pose_sharing](pose_sharing/README_ja.md) | DNS-SDによる姿勢共有 | 同じWi-Fi、motion |
| [face_tracker](face_tracker/README_ja.md) | UnitV2の連続HTTP結果から注視 | Wi-Fi、UnitV2、motion |
| [mediapipe_ble](mediapipe_ble/README_ja.md) | 最新の顔・手の追跡と失効 | BLE、WebのMediaPipe送信側 |
| [lip_sync](lip_sync/README_ja.md) | マイクの音量から口の開きを計算 | ライブ入力に対応したマイク |
| [web_radio](web_radio/README_ja.md) | MP3再生、局変更、停止 | CoreS3、Wi-Fi |
| [unit_temperature](unit_temperature/README_ja.md) | 型付きの外部センサー | SHT3x、外部I²C |
| [servo_diagnostics](servo_diagnostics/README_ja.md) | 状態読取、校正、明示的な保存 | 設定済みSCServo / DYNAMIXEL / RS30X |

後半14例は host API 7 が必要です。先行7例はそれぞれの `stackchan-mod.json` に最小 host API を記録しています。WASM で使えない BLE・DNS-SD・クラウド接続・外部センサー・保守操作は `UNSUPPORTED` になります。機種宣言は実機での接続・性能の受入結果ではありません。

`provider-dialogues` は Claude / Gemini / ChatGPT・MCP連携の低レベル参考ライブラリーと試験で、実行入口・MOD宣言を持つアプリではありません。今回の「全例」は `stackchan-mod.json` を持つ実行例を指します。この参考実装の整理と他の再設計残件は [残る旧経路](../../../docs/architecture/firmware-retirement-plan.md) に記録します。

## ビルド、改造、復帰

このブランチのホストを書き込み、`firmware/` で例をビルドします。

```sh
npm run mod:build -- mods/examples/conversation/manifest.json
npm run mod -- mods/examples/conversation/manifest.json
```

2つ目は既定の CoreS3 へ書き込みます。他の対応機種では `mod:stackchan_rt` / `mod:takao_core2_sg90` を使います。全パッケージのビルドは次で再現できます。

```sh
for metadata in mods/examples/*/stackchan-mod.json; do
  npm run mod:build -- "${metadata%/*}/manifest.json" || exit 1
done
```

初めは `mod.ts` / `mod.js` の文や周期を1箇所変えて再ビルドします。アプリの `setup(app)` が入力・周期・接続を登録し、アプリ終了でそれらを解除します。顔の装飾も本体の初期状態へ戻ります。個別に止めるときは、メニューか SDK が返す解除関数 / `await connection.close()` を使います。

- `CONFIG`：示された設定を保存し、適用時点に合わせてMODまたは本体を再起動します。
- `UNSUPPORTED`：対応機種と必要な機器を確認します。WASMでの未実装を機器の故障と混同しません。
- `BUSY`：先に動かしている音声・会話・診断を止めてから再操作します。
- `IO` / `TIMEOUT`：配線、相手の起動、Wi-FiやURLを確認し、その例の停止・再接続手順を使います。物理機器の解放失敗は本体再起動が必要です。

周期処理は同時に一つだけ実行し、処理の失敗を表示して次の周期で再試行します。同じメニューの処理中に同じ項目を重ねて実行しません。異なる入口が同じ音声などを使う場合は、基盤が競合を判定します。

旧パッケージ名のXSAはそのまま使わず、統合先のソースと宣言で再生成してください。初学者による導入・改造・復帰と、無線・音声・サーボの実機受入は未実施です。自動検証の結果は [実装記録](../../../docs/architecture/firmware-sdk-redesign-progress.md) に分けて記録します。
