# 既存 MOD の移行台帳

## 現在の移行先（2026-09-08）

元の32例を21個の公開SDKパッケージへ移行・統合した。残っていた21例の移行先は14パッケージ、最小host APIは7である。実行例のAPI 1宣言と旧フックは0件。型・import境界・archive生成を検査し、設定・操作・改造・復帰手順を各READMEへ揃えた。実機・初学者の受入とV1ホスト／Blocklyの撤去は残る。[全例の選び方](../../firmware/mods/examples/README_ja.md)、[今回の契約と検証](sdk-example-migration-2026-09-08.md)を参照する。

<details>
<summary>2026-09-06時点の棚卸しの説明（履歴）</summary>

この一覧は API 1 の依存を宣言へ接続した記録で、V2 SDK への移行や実機受入の完了ではない。初学者の入口は `firmware/lessons` とする。全32例の SDK 移行は F5 の未完了項目として継続する。

`portable` はボード名の制限を置かないという宣言であり、必要機能の有無は別に判定する。ここに挙げた機種は候補で、実機の適合証明ではない。実際の機能表と target を本体から得る検査は F7 / F10 で接続する。`extension.*` は低レベル機器への依存を表し、公開 SDK に実装済みという意味ではない。

サーボ診断3例は `legacy-servo-diagnostics` として通常教材から区別した。`setup_rs30x` は二重の入力代入と旧 `_driver`、`calibration` は未完成の校正と旧 `_driver`、`dynamixel` は特定サーボを直接制御する診断コードを含む。現行の標準機種で実行可能だとは宣言しない。診断用の公開拡張と設定手順へ移行するまで、初学者向けの配布には含めない。


</details>

| 旧例 | 移行先（app API 2） | 最小host API | target宣言 |
| --- | --- | ---: | --- |
| `ai_stackchan` | 統合 → [conversation](../../firmware/mods/examples/conversation/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `ai_stackchan_api` | 統合 → [conversation](../../firmware/mods/examples/conversation/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `beacon_advertiser` | 統合 → [beacon](../../firmware/mods/examples/beacon/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `beacon_scanner` | 統合 → [beacon](../../firmware/mods/examples/beacon/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `calibration` | 統合 → [servo_diagnostics](../../firmware/mods/examples/servo_diagnostics/README_ja.md) | 7 | portable |
| `chat_audioio` | 移行 → [chat_audioio](../../firmware/mods/examples/chat_audioio/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `chatgpt` | 統合 → [conversation](../../firmware/mods/examples/conversation/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `cheerup_ble_lite` | 統合 → [cheerup](../../firmware/mods/examples/cheerup/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `cheerup_ws` | 統合 → [cheerup](../../firmware/mods/examples/cheerup/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `codex_voice` | 移行 → [codex_voice](../../firmware/mods/examples/codex_voice/README_ja.md) | 7 | m5stackchan-cores3 |
| `dynamixel` | 統合 → [servo_diagnostics](../../firmware/mods/examples/servo_diagnostics/README_ja.md) | 7 | portable |
| `face` | 移行 → [face](../../firmware/mods/examples/face/README_ja.md) | 4 | m5stackchan-cores3, simulator, portable |
| `face_tracker` | 移行 → [face_tracker](../../firmware/mods/examples/face_tracker/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `image_avatar_lite` | 移行 → [image_avatar_lite](../../firmware/mods/examples/image_avatar_lite/README_ja.md) | 6 | portable, simulator |
| `light` | 統合 → [board_diagnostics](../../firmware/mods/examples/board_diagnostics/README_ja.md) | 5 | portable, simulator |
| `lip_sync` | 移行 → [lip_sync](../../firmware/mods/examples/lip_sync/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `local_peer_hello` | 移行 → [local_peer_hello](../../firmware/mods/examples/local_peer_hello/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `localized_drawer` | 統合 → [face](../../firmware/mods/examples/face/README_ja.md) | 4 | m5stackchan-cores3, simulator, portable |
| `look_around` | 移行 → [look_around](../../firmware/mods/examples/look_around/README_ja.md) | 2 | portable |
| `m5stackchan_smoke` | 統合 → [board_diagnostics](../../firmware/mods/examples/board_diagnostics/README_ja.md) | 5 | portable, simulator |
| `mcp` | 移行 → [mcp](../../firmware/mods/examples/mcp/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `mediapipe_ble` | 移行 → [mediapipe_ble](../../firmware/mods/examples/mediapipe_ble/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `mimic_follow` | 統合 → [pose_sharing](../../firmware/mods/examples/pose_sharing/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `mimic_main` | 統合 → [pose_sharing](../../firmware/mods/examples/pose_sharing/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `mini_app_sample` | 統合 → [stackchan_minigames](../../firmware/mods/examples/stackchan_minigames/README_ja.md) | 3 | portable |
| `mini_app_ui_sample` | 移行 → [mini_app_ui_sample](../../firmware/mods/examples/mini_app_ui_sample/README_ja.md) | 3 | portable, simulator |
| `monologue` | 移行 → [monologue](../../firmware/mods/examples/monologue/README_ja.md) | 2 | portable |
| `setup_rs30x` | 統合 → [servo_diagnostics](../../firmware/mods/examples/servo_diagnostics/README_ja.md) | 7 | portable |
| `stackchan_catch` | 統合 → [stackchan_minigames](../../firmware/mods/examples/stackchan_minigames/README_ja.md) | 3 | portable |
| `stackchan_minigames` | 移行 → [stackchan_minigames](../../firmware/mods/examples/stackchan_minigames/README_ja.md) | 3 | portable |
| `unit_temperature` | 移行 → [unit_temperature](../../firmware/mods/examples/unit_temperature/README_ja.md) | 7 | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `web_radio` | 移行 → [web_radio](../../firmware/mods/examples/web_radio/README_ja.md) | 7 | m5stackchan-cores3 |

以下の日付付き記録の未移行件数は当時の数であり、現在の状態は冒頭の表を参照する。

## 当時の整理方針と移行済みの例（2026-09-06）

上表は旧 API の依存を記録したもの。全32例の「移行」「統合」の分類、保持する機能、必要な SDK、対応する撤去経路は [旧経路の撤去台帳](firmware-retirement-plan.md) に記録した。`look_around` と `monologue` は SDK 世代2へ移行し、主入力・所有された周期処理／音声を使う。残る30例の移行・統合は未実装。機種サポートや独立した機能を、分類だけで削除済みとはしない。

移行済みの例は公開 SDK の strict 検査と解決済み import graph の検査へ含める。自由文と素材再生の区別・再生中の連打・見回し停止・終了後の入力とタイマー解除・未対応時の案内を単体試験で確認し、2例の archive を WASM 上で実行した。実機・初学者による受入は未実施。

## Piu アプリの移行・統合（2026-09-06）

`mini_app_sample` と `stackchan_catch` の実装は `stackchan_minigames/jump.ts` / `catch.ts` に集約し、単独 archive を撤去した。ミニゲーム集と `mini_app_ui_sample` は `definePiuApp` を使う通常の SDK アプリへ移行済み。画面登録は AppSession の寿命に属し、専用 Compartment・loader・合成器・旧 miniapp 配布形式を削除した。ゲームと UI の機能、素材・ライセンスは保持した。

元の32例のうち6例が SDK の4パッケージへ移行・統合済みで、残る26例は未移行。Piu 拡張は host API 3 を要求し、旧 miniapp archive は再生成が必要。自動試験と実機・初学者受入を区別し、詳しい撤去対象と結果は [撤去台帳](firmware-retirement-plan.md) と [実装記録](firmware-sdk-redesign-progress.md) に記載する。


## 顔と翻訳メニューの統合（2026-09-06）

`face` を SDK のUI拡張へ移し、周期的な表情・色・吹き出し・眠気の装飾を保持した。`localized_drawer` のメニューと三言語の辞書はこの例へ統合し、旧プログラムと単独archiveのmanifestを削除した。レイアウトとフォントはホストの共通表示を使う。最小host APIは4。

元の32例のうち8例がSDKの5パッケージへ移行・統合済みで、残る24例は未移行。既定動作もSDKへ移り、旧通常MODはその動作を継承しない。残る旧MODの起動とraw context自体の撤去は未完了。検証結果と未受入の項目は [実装記録](firmware-sdk-redesign-progress.md) に記載する。


## LED とCoreS3診断の統合（2026-09-06）

`light` と `m5stackchan_smoke` は [board_diagnostics](../../firmware/mods/examples/board_diagnostics/README_ja.md) へ統合し、旧プログラムと単独manifestを撤去した。自動診断、CoreS3のhead LED、全LEDモード、A/B/Cの操作を保持し、機器なし・故障時の案内と終了時の取消しをSDKへ揃えた。最小host APIは5。USB診断runnerと手順も統合先を使う。

元の32例のうち10例がSDKの6パッケージへ移行・統合済み、22例は未移行。実機による動作・トルク・LEDの受入と初学者の受入は未完了。自動試験・ビルド・ブラウザーの結果は [実装記録](firmware-sdk-redesign-progress.md) を参照する。


## 画像アバターの SDK 化（2026-09-07）

`image_avatar_lite` を `defineApp` と SDK の `ui(app).setImageAvatar(pack)` へ移した。6キャラクター・12表情・43画像と配置・ライセンスを保持し、主入力とメニューから同じ選択を操作する。表情名をSDKへ統一し、画像名・サイズの二重指定を廃止した。グローバル登録・ID検索と暗黙のfallback・`ui.avatar`・内部描画moduleへの直接依存を撤去した。大きさの異なる顔への切り替えは表示の中心を保つ。最小host APIは6で、パック形式とarchiveの再生成が必要。

元の32例のうち11例がSDKの7パッケージへ移行・統合済み、21例は未移行。[改造・復帰手順](../../firmware/mods/examples/image_avatar_lite/README_ja.md) を追加した。実機の表示・メモリーと初学者の受入は未完了。自動試験と計測は [実装記録](firmware-sdk-redesign-progress.md) を参照する。
