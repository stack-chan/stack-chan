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
| `face` | `mod.js` | face, ui.effects | portable |
| `face_tracker` | `mod.js` | motion, connectivity.network | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `image_avatar_lite` | `mod.js` | face, ui.imageAvatar | portable |
| `light` | `mod.js` | lighting, input.buttons | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `lip_sync` | `mod.js` | face, audio.record | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `local_peer_hello` | `mod.js` | connectivity.localPeer, ui.drawer | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `localized_drawer` | `mod.js` | ui.drawer | portable |
| `look_around` | `mod.js` | motion, input.buttons | portable |
| `m5stackchan_smoke` | `mod.js` | motion, lighting | m5stackchan-cores3 |
| `mcp` | `mod.js` | face, audio.speech, connectivity.network, ui.drawer | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `mediapipe_ble` | `mod.js` | connectivity.localPeer, motion, ui.effects | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `mimic_follow` | `mod.js` | motion, connectivity.network | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `mimic_main` | `mod.js` | motion, connectivity.network | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `mini_app_sample` | `miniapp.ts` | ui.miniApps | portable |
| `mini_app_ui_sample` | `miniapp.ts` | ui.miniApps | portable |
| `monologue` | `mod.js` | audio.speech, input.buttons | portable |
| `setup_rs30x` | `mod.js` | input.buttons, extension.servo.rs30x | legacy-servo-diagnostics |
| `stackchan_catch` | `miniapp.ts` | ui.miniApps | portable |
| `stackchan_minigames` | `miniapp.ts` | ui.miniApps | portable |
| `unit_temperature` | `mod.js` | extension.sensor.sht3x, ui.drawer | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
| `web_radio` | `mod.ts` | audio.webRadio, connectivity.network, ui.drawer, ui.effects | m5stackchan-cores3, stackchan-rt, takao-core2-sg90 |
