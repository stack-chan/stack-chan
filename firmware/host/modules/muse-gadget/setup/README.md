# Explicit setup approval gates

This is an opt-in, pure JavaScript coordinator and UI description. It is not imported by the host or pairing fixture. It does not instantiate native owners, advertise, save credentials, or connect on startup or receipt.

`acceptProvision(accountOwner, generation)` receives only an opaque owner and its generation. On successful acceptance the coordinator owns its lifetime. It reads `current(generation)` and presents fixed descriptions; it never requests SSID, passwords, tokens, endpoints, or arbitrary metadata strings.

The UI obtains `describeSetupPrompt(coordinator)` and renders its title, description, boolean metadata, and button label. It invokes `confirm` only for a distinct explicit user action. The two buttons are:

1. **この端末にWiFiとMuse資格情報を保存** calls `commitApproved(generation)`.
2. **Museへ接続** appears after confirmed saving and calls `connectApproved(generation)` only on a separate action.

Each prompt captures its display revision. A stale button cannot approve a replacement owner or a later step. Duplicate clicks during the same operation share its promise. No automatic retry or connect follows saving. `close()` invalidates the displayed revision, closes the owned native session, and ignores delayed results. Closing cannot promise to undo an external side effect that the native layer already completed; cancellation and atomic persistence must also be enforced natively.

## Future native adapter contract

The native AccountSession facade is not wired here. The agreed interface is:

- `current(generation)` returns exactly `true` while this owner/generation remains usable, including after saving. It is independent of the earlier BLE handshake phase token.
- `commitApproved(generation)` resolves to `{ saved: true }` only after durable saving succeeds.
- `connectApproved(generation)` resolves to `{ connected: true }` only after the actual Muse/Noise connection is confirmed. HTTP token resolution alone is not a connection.
- `close()` invalidates ownership and releases native resources.

All methods may be synchronous or return promises except `current` and `close`. `undefined`, false, or missing success flags do not advance the UI. Unknown result fields and native exception details never enter display metadata. Errors from the coordinator have fixed strings only.

`node --test host/modules/muse-gadget/setup/coordinator.test.mjs` exercises only fake owners. These tests do not perform real credential saving or network requests and do not claim that an AccountSession/native storage integration is complete.

The save prompt is not a claim of encrypted flash storage. The adapter uses the device's existing NVS configuration and does not enable encryption, burn eFuses, or erase partitions. Before real provisioning, explain that persistent credential protection depends on that existing configuration.

## Opaque accountから会話へ接続する

`account-voice-manifest.json`はopt-inのhostだけに組み込む。既存の文字列設定を受ける`muse-voice`と他providerの契約は変えない。

`createMuseAccountVoiceConversation(account, {nodeId, appId})`はopaque ownerを保持し、transportを開く時だけCの型検証済みsinkへ渡す。host、VM ID、bearerはC内でtransport専用bufferへコピーする。JavaScriptへ戻さず、transportのcloseで消去する。ownerのメモリを借用し続けない。

新factoryのappId既定値は`hatch-web`。公式pin `f2c702b123e97f4fecdaefb29ded17bb03fab0b0`の`muse_chat_session.cpp`はend-callの`x-app-id`にこの値を使う。WebSocketのapp_idは構成値を使うため、setup hostでも同じ値を明示する。既存factoryの既定値は変更しない。

`createConversationAccountOwner`は明示された接続承認でだけ、SDK WiFiの初期化、opaque native WiFi設定、IP取得、実NTP同期、native HTTP準備、初期muteのpipeline開始を順に行う。`prepared: true`はHTTP準備完了を表す。voice admission完了後だけ`connected: true`を返す。固定時刻への代替はない。

PTT前はマイクの実音声を送信しない。ただし既存PCM runtimeはmute中もADCから取得して破棄するため、マイク取得自体を開始しないとは保証しない。

`close()`はPromiseを返す。会話開始後はpipeline終了、WiFi disconnect、WiFi close、account closeの順で片付ける。準備中はWiFiとaccountを先に中止してpending結果を破棄する。coordinatorもこのPromiseを返すため、呼出元は完了後に次の接続を始める。

native専用ストアから復元したownerは`acceptStored`へ渡す。再保存せず接続承認待ちにする。旧Preferenceから秘密値を移す入口ではない。

mockテスト成功は実pairing、NVS保存、WiFi接続、Muse会話の成功を意味しない。
