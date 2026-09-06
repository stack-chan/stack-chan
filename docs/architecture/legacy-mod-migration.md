# 既存 MOD の移行台帳

この一覧は API 1 の依存を宣言へ接続した記録で、V2 SDK への移行や実機受入の完了ではない。初学者の入口は `firmware/lessons` とする。全32例の SDK 移行は F5 の未完了項目として継続する。

`portable` はボード名の制限を置かないという宣言であり、必要機能の有無は別に判定する。ここに挙げた機種は候補で、実機の適合証明ではない。実際の機能表と target を本体から得る検査は F7 / F10 で接続する。`extension.*` は低レベル機器への依存を表し、公開 SDK に実装済みという意味ではない。

サーボ診断3例は `legacy-servo-diagnostics` として通常教材から区別した。`setup_rs30x` は二重の入力代入と旧 `_driver`、`calibration` は未完成の校正と旧 `_driver`、`dynamixel` は特定サーボを直接制御する診断コードを含む。現行の標準機種で実行可能だとは宣言しない。診断用の公開拡張と設定手順へ移行するまで、初学者向けの配布には含めない。

| 例 | 実行入口 | 宣言した依存 | target 制限 |
| --- | --- | --- | --- |
| `ai_stackchan` | `mod.js` | face, audio.record, audio.speech, audio.tone, input.buttons, connectivity.network, ui.effects | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `ai_stackchan_api` | `mod.js` | face, audio.speech, input.buttons, connectivity.network, ui.effects, ui.drawer | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `beacon_advertiser` | `mod.js` | audio.speech, input.buttons, connectivity.ble | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `beacon_scanner` | `mod.js` | audio.speech, connectivity.ble | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `calibration` | `mod.js` | input.buttons, extension.servo.scservo | legacy-servo-diagnostics |
| `chat_audioio` | `mod.js` | face, audio.conversation, audio.tone, motion, connectivity.network, ui.drawer, ui.effects | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `chatgpt` | `mod.js` | audio.speech, input.buttons, motion, connectivity.network | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `cheerup_ble_lite` | `mod.js` | face, audio.speech, motion, connectivity.ble | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `cheerup_ws` | `mod.js` | face, audio.speech, motion, connectivity.network | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `codex_voice` | `mod.js` | conversation.remote, audio.usb, input.headTouch, ui.drawer | m5stackchan-cores3 |
| `dynamixel` | `mod.js` | extension.servo.dynamixel | legacy-servo-diagnostics |
| `face` | `mod.js` | SDK face, ui.controls | portable / simulator |
| `face_tracker` | `mod.js` | motion, connectivity.network | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `image_avatar_lite` | `mod.js` | face, ui.imageAvatar | portable |
| `light` | `mod.js` | lighting, input.buttons | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `lip_sync` | `mod.js` | face, audio.record | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `local_peer_hello` | `mod.js` | connectivity.localPeer, ui.drawer | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `localized_drawer` | 統合 → `face/mod.js` | SDK ui.controls・三言語の辞書 | 単独 archive を撤去 |
| `look_around` | `mod.js` | motion, input.buttons | portable |
| `m5stackchan_smoke` | `mod.js` | motion, lighting | m5stackchan-cores3 |
| `mcp` | `mod.js` | face, audio.speech, connectivity.network, ui.drawer | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `mediapipe_ble` | `mod.js` | connectivity.localPeer, motion, ui.effects | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `mimic_follow` | `mod.js` | motion, connectivity.network | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `mimic_main` | `mod.js` | motion, connectivity.network | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `mini_app_sample` | 統合 → `stackchan_minigames/jump.ts` | SDK ui.piu | 単独 archive を撤去 |
| `mini_app_ui_sample` | `mod.ts` / `screen.ts` | SDK ui.piu | portable / simulator |
| `monologue` | `mod.js` | audio.speech, input.buttons | portable |
| `setup_rs30x` | `mod.js` | input.buttons, extension.servo.rs30x | legacy-servo-diagnostics |
| `stackchan_catch` | 統合 → `stackchan_minigames/catch.ts` | SDK ui.piu | 単独 archive を撤去 |
| `stackchan_minigames` | `mod.ts` / `jump.ts` / `catch.ts` | SDK ui.piu | portable |
| `unit_temperature` | `mod.js` | extension.sensor.sht3x, ui.drawer | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `web_radio` | `mod.ts` | audio.webRadio, connectivity.network, ui.drawer, ui.effects | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |

## 現在の整理方針と移行済みの例（2026-09-06）

上表は旧 API の依存を記録したもの。全32例の「移行」「統合」の分類、保持する機能、必要な SDK、対応する撤去経路は [旧経路の撤去台帳](firmware-retirement-plan.md) に記録した。`look_around` と `monologue` は SDK 世代2へ移行し、主入力・所有された周期処理／音声を使う。残る30例の移行・統合は未実装。機種サポートや独立した機能を、分類だけで削除済みとはしない。

移行済みの例は公開 SDK の strict 検査と解決済み import graph の検査へ含める。自由文と素材再生の区別・再生中の連打・見回し停止・終了後の入力とタイマー解除・未対応時の案内を単体試験で確認し、2例の archive を WASM 上で実行した。実機・初学者による受入は未実施。

## Piu アプリの移行・統合（2026-09-06）

`mini_app_sample` と `stackchan_catch` の実装は `stackchan_minigames/jump.ts` / `catch.ts` に集約し、単独 archive を撤去した。ミニゲーム集と `mini_app_ui_sample` は `definePiuApp` を使う通常の SDK アプリへ移行済み。画面登録は AppSession の寿命に属し、専用 Compartment・loader・合成器・旧 miniapp 配布形式を削除した。ゲームと UI の機能、素材・ライセンスは保持した。

元の32例のうち6例が SDK の4パッケージへ移行・統合済みで、残る26例は未移行。Piu 拡張は host API 3 を要求し、旧 miniapp archive は再生成が必要。自動試験と実機・初学者受入を区別し、詳しい撤去対象と結果は [撤去台帳](firmware-retirement-plan.md) と [実装記録](firmware-sdk-redesign-progress.md) に記載する。


## 顔と翻訳メニューの統合（2026-09-06）

`face` を SDK のUI拡張へ移し、周期的な表情・色・吹き出し・眠気の装飾を保持した。`localized_drawer` のメニューと三言語の辞書はこの例へ統合し、旧プログラムと単独archiveのmanifestを削除した。レイアウトとフォントはホストの共通表示を使う。最小host APIは4。

元の32例のうち8例がSDKの5パッケージへ移行・統合済みで、残る24例は未移行。既定動作もSDKへ移り、旧通常MODはその動作を継承しない。残る旧MODの起動とraw context自体の撤去は未完了。検証結果と未受入の項目は [実装記録](firmware-sdk-redesign-progress.md) に記載する。
