---
"stack-chan": minor
---

M5StackChan CoreS3標準ホストへ、MODから論理セッションを遅延起動できるUSB remote conversation sessionを追加します。
USBSerialを所有する物理ブリッジとapplication EVENT runtimeはhost起動時に確保します。
MODの`activate()`はcontextを関連付け、会話状態ハンドラと状態表示を開始します。
Codex Voice MODは、会話開始前にremote sessionを有効化して承認要求を受信します。
